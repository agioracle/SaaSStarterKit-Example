import { z } from "zod";
import type { Bindings } from "../env";
import { websiteConfig } from "../config/website";
import { sendPaymentNotification } from "../notification/index.server";
import {
	groupedPlans,
	publicPlans,
	publicPriceIds,
	paymentCatalogId,
	assertUniquePaymentCatalogIds,
} from "../config/plans";
import {
	createD1PaymentStore,
	checkPaymentDeployment,
} from "../db/payment-store";
import {
	createPaymentService,
	createRegisteredPaymentProvider,
	providerRegistry,
	isRegisteredPaymentProvider,
	getProviderRegistration,
	paymentWebhookResponse,
} from "../payment";
import type {
	PaymentPlan,
	PaymentUser,
	PaymentProviderId,
	PaymentCheckoutStatus,
	PaymentStore,
} from "../payment/types";
import { HttpError, json, readJson, errorResponse } from "../lib/security";
import { stringEnv } from "./runtime.server";
import { logDiagnostic, type DiagnosticContext } from "../lib/diagnostics";
import { hasPaymentAccess } from "../payment/entitlements";
import { paymentNamespaceIdentity, paymentMode } from "../payment/namespace";
import { paymentApplicationOrigin } from "../payment/utils";
const appOrigin = (env: Record<string, string | undefined>) =>
	paymentApplicationOrigin(
		env.APP_URL,
		import.meta.env.VITE_BASE_URL || import.meta.env.VITE_APP_URL,
	);
const providerIds = () =>
	Object.keys(providerRegistry).filter(isRegisteredPaymentProvider);
export function configuredPaymentProviders(env: Bindings): PaymentProviderId[] {
	const legacy = (stringEnv(env).PAYMENT_LEGACY_PROVIDERS || "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	if (legacy.some((value) => !isRegisteredPaymentProvider(value)))
		throw new HttpError(503, "Invalid legacy payment provider configuration.");
	return [
		...new Set(
			[websiteConfig.payment.provider, ...legacy].filter(
				(value): value is PaymentProviderId =>
					isRegisteredPaymentProvider(value),
			),
		),
	];
}
export async function paymentNamespace(
	env: Bindings,
	provider: PaymentProviderId,
) {
	const values = stringEnv(env);
	return paymentNamespaceIdentity(
		{ ...values, APP_URL: appOrigin(values) },
		provider,
	);
}
/** Grouped public price configuration applies only to today's provider, never historical merchants. */
export function paymentPriceId(
	provider: PaymentProviderId,
	catalogId: string,
	env: Record<string, string | undefined>,
	activeProvider: string = websiteConfig.payment.provider,
): string | undefined {
	let configured: string | undefined;
	if (provider === activeProvider) {
		assertUniquePaymentCatalogIds(groupedPlans);
		configured = Object.values(groupedPlans)
			.flatMap((plan) =>
				plan.prices.map((price) => ({
					price,
					id: paymentCatalogId(plan, price),
				})),
			)
			.find((entry) => entry.id === catalogId)?.price.priceId;
	}
	const prefix = provider.replaceAll("-", "_").toUpperCase();
	return (
		configured ||
		env[`${prefix}_${catalogId.replaceAll("-", "_").toUpperCase()}_PRICE_ID`] ||
		publicPriceIds[provider]?.[catalogId]
	);
}
export function paymentRuntime(
	env: Bindings,
	requestedProvider?: PaymentProviderId,
) {
	const e = stringEnv(env);
	const providerId = requestedProvider ?? websiteConfig.payment.provider;
	if (!providerId || !configuredPaymentProviders(env).includes(providerId))
		throw new HttpError(503, "Payment provider management is not configured.");
	const mode = paymentMode(e.PAYMENT_MODE);
	const { provider, credentialMode } = createRegisteredPaymentProvider(
		providerId,
		e,
		mode,
	);
	const prefix = providerId.replaceAll("-", "_").toUpperCase();
	const plans: PaymentPlan[] = publicPlans
		.filter((p) => p.kind !== "free")
		.flatMap((p) => {
			const priceId = paymentPriceId(providerId, p.id, e);
			if (!priceId) return [];
			return [
				{
					id: p.id,
					priceId,
					kind: p.kind === "subscription" ? "subscription" : "one_time",
					currency: p.currency.toLowerCase(),
					amount: p.amount,
					...(p.interval ? { interval: p.interval } : {}),
					...(p.trialPeriodDays ? { trialPeriodDays: p.trialPeriodDays } : {}),
					allowPromotionCodes: p.allowPromotionCodes,
				},
			];
		});
	// Preserve retired prices explicitly for webhook reconciliation without advertising them.
	const historicalPlans =
		e[`${prefix}_HISTORICAL_PLANS`] ||
		(providerId === websiteConfig.payment.provider
			? e.PAYMENT_HISTORICAL_PLANS
			: undefined);
	if (historicalPlans) {
		const history = z
			.array(
				z.object({
					id: z.string(),
					priceId: z.string(),
					kind: z.enum(["subscription", "one_time"]),
					currency: z.string(),
					amount: z.number().int(),
					interval: z.enum(["month", "year"]).optional(),
				}),
			)
			.parse(JSON.parse(historicalPlans));
		plans.push(...history);
	}
	return {
		provider,
		plans,
		runtime: {
			provider: providerId,
			mode,
			credentialMode,
			newCheckoutEnabled:
				websiteConfig.payment.enabled &&
				e.PAYMENT_NEW_CHECKOUTS_ENABLED !== "false",
		},
		service: createPaymentService({
			provider,
			plans,
			appOrigin: appOrigin(e),
			store: createD1PaymentStore(env.DB),
			namespace: () => paymentNamespace(env, providerId),
			manageableProviders: configuredPaymentProviders(env),
			onPaymentRecorded: async (event, checkout) => {
				if (!websiteConfig.notification.enabled) return;
				const customer = await env.DB.prepare(
					"SELECT name FROM user WHERE id=?",
				)
					.bind(checkout.userId)
					.first<{ name: string }>();
				const notification = await sendPaymentNotification(env, {
					sessionId:
						event.lookup.sessionId || checkout.sessionId || checkout.reference,
					customerId: event.lookup.customerId || checkout.userId,
					userName: customer?.name || "Customer",
					amount: (event.plan || checkout.plan).amount,
					currency: (event.plan || checkout.plan).currency,
				});
				if (notification.some((delivery) => !delivery.accepted))
					logDiagnostic(
						{ code: "UPSTREAM" },
						{
							operation: "payment.notification",
							provider: providerId,
							eventId: event.id,
						},
					);
			},
		}),
	};
}
/** Legacy return links may contain only a provider session alias. Resolve only
 * an unambiguous owned checkout; never assume today's new-checkout provider. */
export async function resolveOwnedPayment(
	store: PaymentStore,
	userId: string,
	reference: string,
	explicitProvider?: PaymentProviderId,
) {
	if (!reference || reference.length > 256)
		throw new HttpError(400, "Invalid payment reference.");
	const candidates = await Promise.all(
		(explicitProvider ? [explicitProvider] : providerIds()).map((provider) =>
			store.findCheckout(provider, {
				checkoutReference: reference,
				sessionId: reference,
			}),
		),
	);
	const owned = candidates.filter((row) => row?.userId === userId);
	if (owned.length > 1)
		throw new HttpError(
			400,
			"Payment provider is ambiguous. Open the exact payment from billing history.",
		);
	const checkout = owned[0];
	if (!checkout) throw new HttpError(404, "Checkout not found.");
	return checkout;
}
export async function handlePayments(
	request: Request,
	env: Bindings,
	user: PaymentUser,
) {
	const url = new URL(request.url);
	const e = stringEnv(env);
	const store = createD1PaymentStore(env.DB);
	const providers = configuredPaymentProviders(env);
	const providerSchema = z
		.string()
		.refine(isRegisteredPaymentProvider, "Unknown payment provider");
	if (request.method === "GET") {
		const reference =
			url.searchParams.get("reference") || url.searchParams.get("session_id");
		if (reference) {
			const selected = url.searchParams.get("provider");
			const checkout = await resolveOwnedPayment(
				store,
				user.id,
				reference,
				selected ? providerSchema.parse(selected) : undefined,
			);
			const provider = checkout.provider;
			if (providers.includes(provider))
				return json(
					await paymentRuntime(env, provider).service.getCheckoutStatus(
						user,
						checkout.reference,
					),
				);
			await checkPaymentDeployment(
				env.DB,
				paymentMode(e.PAYMENT_MODE),
				e.PAYMENT_NAMESPACE || appOrigin(e),
			);
			const payment = await store.getSnapshot?.(provider, checkout.reference);
			if (!payment) throw new HttpError(404, "Checkout not found.");
			return json(publicStatus(payment, false));
		}
		const limit = z.coerce
			.number()
			.int()
			.min(1)
			.max(50)
			.parse(url.searchParams.get("limit") || 20);
		const page = await store.listHistory?.(user.id, {
			limit,
			cursor: url.searchParams.get("cursor") || undefined,
		});
		if (!page) throw new HttpError(503, "Payment history unavailable.");
		const current = websiteConfig.payment.provider;
		const runtime = current ? paymentRuntime(env, current) : null;
		if (runtime) {
			const ns = await paymentNamespace(env, current as PaymentProviderId);
			await store.assertNamespace?.(
				current as PaymentProviderId,
				ns.mode,
				ns.account,
				ns.deployment,
			);
		} else if (page.items.length)
			await checkPaymentDeployment(
				env.DB,
				paymentMode(e.PAYMENT_MODE),
				e.PAYMENT_NAMESPACE || appOrigin(e),
			);
		const entitlement = await store.getEntitlement?.(user.id, Date.now());
		return json({
			runtime: runtime?.runtime ?? {
				provider: "",
				mode: paymentMode(e.PAYMENT_MODE),
				credentialMode: "unknown",
				newCheckoutEnabled: false,
			},
			checkouts: page.items.map((payment) =>
				publicStatus(payment, providers.includes(payment.provider)),
			),
			nextCursor: page.nextCursor,
			entitlement: entitlement
				? {
						reference: entitlement.reference,
						provider: entitlement.provider,
						plan: entitlement.plan,
						state: entitlement.state,
						paid: entitlement.paid,
						periodEnd: entitlement.periodEnd,
					}
				: null,
			plans: publicPlans
				.filter((plan) => !plan.disabled)
				.map((plan) => ({
					...plan,
					available:
						plan.kind === "free" ||
						Boolean(
							runtime?.runtime.newCheckoutEnabled &&
								runtime.plans.some((candidate) => candidate.id === plan.id),
						),
				})),
		});
	}
	if (request.method !== "POST")
		throw new HttpError(405, "Method not allowed.");
	const body = z
		.discriminatedUnion("action", [
			z.object({
				action: z.literal("checkout"),
				planId: z.string(),
				returnUrl: z.string().optional(),
			}),
			z.object({
				action: z.literal("portal"),
				provider: providerSchema.optional(),
				reference: z.string().optional(),
				returnUrl: z.string().optional(),
			}),
			z.object({
				action: z.literal("cancel"),
				provider: providerSchema.optional(),
				reference: z.string(),
				atPeriodEnd: z.boolean().default(true),
			}),
			z.object({
				action: z.literal("reconcile"),
				provider: providerSchema.optional(),
				reference: z.string(),
				sessionId: z.string().max(256).optional(),
			}),
		])
		.parse(await readJson(request));
	if (body.action === "checkout") {
		if (
			!websiteConfig.payment.enabled ||
			e.PAYMENT_NEW_CHECKOUTS_ENABLED === "false"
		)
			throw new HttpError(404, "New checkouts disabled.");
		const { service, plans } = paymentRuntime(env);
		const plan = plans.find((candidate) => candidate.id === body.planId);
		if (
			!plan ||
			!publicPlans.some(
				(candidate) => candidate.id === plan.id && !candidate.disabled,
			)
		)
			throw new HttpError(400, "Plan is unavailable or not configured.");
		return json(
			await service.createCheckout(user, {
				priceId: plan.priceId,
				successUrl: body.returnUrl,
			}),
			201,
		);
	}
	const selectedProvider =
		body.provider ??
		(body.reference
			? (await resolveOwnedPayment(store, user.id, body.reference)).provider
			: undefined);
	const { service } = paymentRuntime(env, selectedProvider);
	if (body.action === "portal")
		return json(
			await service.createPortal(user, body.returnUrl, body.reference),
		);
	if (body.action === "reconcile")
		return json(
			await service.reconcileCheckout(user, body.reference, body.sessionId),
		);
	await service.cancelSubscription(user, body.reference, body.atPeriodEnd);
	return json({ ok: true });
}
function publicStatus(
	payment: import("../payment/types").PaymentSnapshot,
	canManage: boolean,
): PaymentCheckoutStatus {
	return {
		reference: payment.reference,
		provider: payment.provider,
		state: payment.state,
		paid: payment.paid,
		hasAccess: hasPaymentAccess(payment),
		planId: payment.plan.id,
		periodEnd: payment.periodEnd,
		cancelAtPeriodEnd: payment.cancelAtPeriodEnd,
		lifecycle: payment.lifecycle ?? "unknown",
		reconciliationRequired: payment.reconciliationRequired ?? false,
		canManage,
		canCancel:
			canManage &&
			payment.plan.kind === "subscription" &&
			Boolean(payment.references.subscriptionId) &&
			payment.state !== "canceled" &&
			(!payment.cancelAtPeriodEnd || Boolean(payment.reconciliationRequired)),
		canReconcile:
			canManage &&
			Boolean(
				getProviderRegistration(payment.provider).supportsCheckoutRecovery ||
					(payment.reconciliationRequired &&
						getProviderRegistration(payment.provider)
							.supportsSubscriptionReconciliation),
			) &&
			(!["failed", "expired"].includes(payment.lifecycle ?? "unknown") ||
				Boolean(payment.reconciliationRequired)),
	};
}
export async function handlePaymentWebhook(
	request: Request,
	env: Bindings,
	provider: string,
	context?: DiagnosticContext,
) {
	if (
		!isRegisteredPaymentProvider(provider) ||
		!configuredPaymentProviders(env).includes(provider as PaymentProviderId)
	)
		return new Response("Not found", { status: 404 });
	try {
		const { service } = paymentRuntime(env, provider as PaymentProviderId);
		return paymentWebhookResponse(request, {
			enabled: true,
			configuredProvider: provider,
			routeProvider: provider,
			service,
			context,
		});
	} catch (error) {
		return errorResponse(
			error,
			context ?? { operation: "payment.webhook", provider },
		);
	}
}
