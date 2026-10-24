import {
	foldPaymentEvents,
	getCurrentEntitlement,
	hasPaymentAccess,
} from "./entitlements";
import {
	PaymentError,
	type CheckoutRecord,
	type PaymentEvent,
	type PaymentPlan,
	type PaymentAdapter,
	type PaymentStore,
	type PaymentUser,
	type PaymentSnapshot,
	type PaymentCheckoutStatus,
	type PaymentProviderId,
	type PaymentMode,
	type PaymentRecoveryResult,
} from "./types";
import { hostedUrl, sameOriginReturnUrl } from "./utils";
import { logDiagnostic, type DiagnosticContext } from "../lib/diagnostics";
export interface PaymentServiceConfig {
	provider: PaymentAdapter;
	plans: readonly PaymentPlan[];
	appOrigin: string;
	store: PaymentStore;
	now?: () => number;
	newReference?: () => string;
	namespace?:
		| { mode: PaymentMode; account: string; deployment?: string }
		| (() => Promise<{
				mode: PaymentMode;
				account: string;
				deployment?: string;
		  }>);
	manageableProviders?: readonly PaymentProviderId[];
	onPaymentRecorded?: (
		event: PaymentEvent,
		checkout: CheckoutRecord,
	) => Promise<void>;
}
export function createPaymentService(config: PaymentServiceConfig) {
	const { provider, store } = config;
	const now = config.now ?? Date.now;
	const authenticate = (user: PaymentUser | null | undefined): PaymentUser => {
		if (!user?.id || !user.email)
			throw new PaymentError("UNAUTHORIZED", "Sign in to manage billing");
		return user;
	};
	const assertNamespace = async () => {
		if (config.namespace) {
			const namespace =
				typeof config.namespace === "function"
					? await config.namespace()
					: config.namespace;
			await store.assertNamespace?.(
				provider.id,
				namespace.mode,
				namespace.account,
				namespace.deployment,
			);
		}
	};
	const snapshot = async (checkout: CheckoutRecord) =>
		(await store.getSnapshot?.(checkout.provider, checkout.reference)) ??
		foldPaymentEvents(
			checkout,
			await store.listEvents(checkout.provider, checkout.reference),
		);
	const owned = async (
		user: PaymentUser | null | undefined,
		reference: string,
	) => {
		const currentUser = authenticate(user);
		if (!reference || reference.length > 256)
			throw new PaymentError("INVALID_INPUT", "Invalid checkout reference");
		const checkout = await store.findCheckout(provider.id, {
			checkoutReference: reference,
			sessionId: reference,
		});
		if (!checkout || checkout.userId !== currentUser.id)
			throw new PaymentError("NOT_FOUND", "Checkout not found");
		return checkout;
	};
	const status = (payment: PaymentSnapshot): PaymentCheckoutStatus => {
		const canManage = (config.manageableProviders ?? [provider.id]).includes(
			payment.provider,
		);
		return {
			reference: payment.reference,
			provider: payment.provider,
			state: payment.state,
			paid: payment.paid,
			hasAccess: hasPaymentAccess(payment, now()),
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
				(payment.reconciliationRequired
					? Boolean(provider.reconcileSubscription)
					: Boolean(provider.reconcileCheckout) &&
						!["failed", "expired"].includes(payment.lifecycle ?? "unknown")),
		};
	};
	const record = async (event: PaymentEvent) => {
		if (event.effect === "ignore") return { status: "ignored" as const };
		const {
			customerId: _customerId,
			subscriptionItemId: _itemId,
			...lookup
		} = event.lookup;
		if (!Object.values(lookup).some(Boolean))
			throw new PaymentError(
				"RETRY",
				"Webhook has no order correlation; provider retry required",
			);
		const checkout = await store.findCheckout(provider.id, lookup);
		if (!checkout)
			throw new PaymentError(
				"RETRY",
				"Checkout context not available yet; provider retry required",
			);
		if (
			event.provider === "stripe" &&
			event.type === "charge.refunded" &&
			checkout.plan.kind !== "one_time"
		)
			event.effect = "receipt";
		if (event.priceId || event.planId) {
			const plan = config.plans.find((candidate) =>
				event.priceId
					? candidate.priceId === event.priceId
					: candidate.id === event.planId,
			);
			if (!plan)
				throw new PaymentError(
					"RETRY",
					"Webhook references an unconfigured payment plan",
				);
			event.plan = plan;
		}
		if (
			event.effect === "grant" &&
			(event.plan?.kind ?? checkout.plan.kind) === "subscription" &&
			!event.periodEnd
		)
			throw new PaymentError(
				"RETRY",
				"Paid subscription period not available; provider retry required",
			);
		const recorded = { ...event, checkoutReference: checkout.reference };
		const result = await store.appendEvent(recorded);
		if (event.lookup.customerId)
			await store.bindCustomer?.(
				checkout.userId,
				provider.id,
				event.lookup.customerId,
			);
		await store.resolveWebhookFailure?.(provider.id, event.id);
		if (
			result === "inserted" &&
			event.effect === "grant" &&
			config.onPaymentRecorded
		) {
			try {
				await config.onPaymentRecorded(recorded, checkout);
			} catch (error) {
				logDiagnostic(error, {
					operation: "payment.notification",
					provider: provider.id,
					eventId: event.id,
				});
			}
		}
		return { status: result };
	};
	return {
		async createCheckout(
			user: PaymentUser | null | undefined,
			input: { priceId: string; successUrl?: string; cancelUrl?: string },
		) {
			const currentUser = authenticate(user);
			await assertNamespace();
			const plan = config.plans.find(
				(candidate) => candidate.priceId === input.priceId,
			);
			if (
				!plan?.priceId ||
				!Number.isSafeInteger(plan.amount) ||
				plan.amount < 0
			)
				throw new PaymentError("INVALID_INPUT", "Unknown or invalid price");
			if (
				plan.kind === "subscription" &&
				(await store.hasUnresolvedSubscription?.(currentUser.id, provider.id))
			)
				throw new PaymentError(
					"INVALID_INPUT",
					"Resolve the existing subscription or open checkout before starting another. Use its billing portal to change plans.",
				);
			const success = new URL(
				sameOriginReturnUrl(
					input.successUrl ?? "/settings/payment",
					config.appOrigin,
				),
			);
			success.searchParams.set("provider", provider.id);
			const successUrl = success.toString();
			const cancelUrl = sameOriginReturnUrl(
				input.cancelUrl ?? "/pricing",
				config.appOrigin,
			);
			const reference = config.newReference?.() ?? crypto.randomUUID();
			let customerId = await store.getCustomer?.(currentUser.id, provider.id);
			if (!customerId && provider.ensureCustomer) {
				customerId = await provider.ensureCustomer(currentUser);
				customerId =
					(await store.bindCustomer?.(
						currentUser.id,
						provider.id,
						customerId,
					)) ?? customerId;
			}
			if (provider.hostsPostCheckoutPage)
				success.searchParams.set("reference", reference);
			const recovery = {
				user: currentUser,
				plan,
				reference,
				successUrl: provider.hostsPostCheckoutPage
					? success.toString()
					: successUrl,
				cancelUrl,
				...(customerId ? { customerId } : {}),
			};
			const checkout: CheckoutRecord = {
				reference,
				provider: provider.id,
				userId: currentUser.id,
				plan,
				createdAt: now(),
				lifecycle: "creating",
				recovery,
			};
			if (store.reserveCheckout) await store.reserveCheckout(checkout);
			else await store.createCheckout(checkout);
			try {
				const result = await provider.createCheckout(recovery);
				await store.attachCheckout(
					provider.id,
					checkout.reference,
					result.sessionId,
				);
				if (result.customerId)
					await store.bindCustomer?.(
						currentUser.id,
						provider.id,
						result.customerId,
					);
				return { reference, ...result };
			} catch (error) {
				await store.setCheckoutLifecycle?.(
					provider.id,
					reference,
					error instanceof PaymentError &&
						error.details?.outcome === "not_created"
						? "failed"
						: "unknown",
				);
				throw error;
			}
		},
		async getCheckoutStatus(
			user: PaymentUser | null | undefined,
			reference: string,
		) {
			await assertNamespace();
			return status(await snapshot(await owned(user, reference)));
		},
		async getHistory(
			user: PaymentUser | null | undefined,
			options: { limit?: number; cursor?: string } = {},
		) {
			const currentUser = authenticate(user);
			if (store.listHistory) {
				const page = await store.listHistory(currentUser.id, {
					limit: options.limit ?? 20,
					cursor: options.cursor,
				});
				return {
					checkouts: page.items.map(status),
					nextCursor: page.nextCursor,
				};
			}
			const rows = await Promise.all(
				(await store.listCheckouts(currentUser.id)).map(snapshot),
			);
			return { checkouts: rows.map(status), nextCursor: null };
		},
		async getEntitlement(user: PaymentUser | null | undefined) {
			const currentUser = authenticate(user);
			await assertNamespace();
			return store.getEntitlement
				? store.getEntitlement(currentUser.id, now())
				: getCurrentEntitlement(
						await Promise.all(
							(await store.listCheckouts(currentUser.id)).map(snapshot),
						),
						now(),
					);
		},
		async createPortal(
			user: PaymentUser | null | undefined,
			returnUrl = "/settings/billing",
			reference?: string,
		) {
			const currentUser = authenticate(user);
			await assertNamespace();
			const safeUrl = sameOriginReturnUrl(returnUrl, config.appOrigin);
			let customerId: string | undefined;
			if (reference)
				customerId = (await snapshot(await owned(user, reference))).references
					.customerId;
			else customerId = await store.getCustomer?.(currentUser.id, provider.id);
			if (!customerId && !store.getCustomer)
				for (const checkout of (await store.listCheckouts(currentUser.id))
					.filter((item) => item.provider === provider.id)
					.sort((a, b) => b.createdAt - a.createdAt)) {
					customerId = (await snapshot(checkout)).references.customerId;
					if (customerId) break;
				}
			if ((provider.requiresCustomerId ?? true) && !customerId)
				throw new PaymentError(
					"NOT_FOUND",
					"No payment customer is associated with this account",
				);
			return {
				url: await provider.createPortal({
					user: currentUser,
					customerId,
					returnUrl: safeUrl,
				}),
			};
		},
		async cancelSubscription(
			user: PaymentUser | null | undefined,
			reference: string,
			atPeriodEnd = true,
		) {
			await assertNamespace();
			const payment = await snapshot(await owned(user, reference));
			if (
				payment.plan.kind !== "subscription" ||
				!payment.references.subscriptionId
			)
				throw new PaymentError("NOT_FOUND", "Subscription not found");
			await provider.cancelSubscription({
				subscriptionId: payment.references.subscriptionId,
				atPeriodEnd,
			});
			return { requested: true as const };
		},
		async reconcileCheckout(
			user: PaymentUser | null | undefined,
			reference: string,
			candidateSessionId?: string,
		): Promise<PaymentRecoveryResult> {
			await assertNamespace();
			const checkout = await owned(user, reference);
			const payment = await snapshot(checkout);
			let checkoutUrl: string | undefined;
			const canReadSubscription = Boolean(
				payment.references.subscriptionId && provider.reconcileSubscription,
			);
			if (payment.references.subscriptionId && provider.reconcileSubscription) {
				const observed = await provider.reconcileSubscription(
					payment.references.subscriptionId,
				);
				await record({
					...observed,
					lookup: {
						...observed.lookup,
						subscriptionId: payment.references.subscriptionId,
						checkoutReference: checkout.reference,
					},
				});
			}
			if (
				provider.reconcileCheckout &&
				!["failed", "expired"].includes(payment.lifecycle ?? "unknown")
			) {
				// Exact same request/key may be replayed only inside the provider's retention guarantee.
				const recovery =
					now() - checkout.createdAt < 23 * 60 * 60 * 1000
						? checkout.recovery
						: undefined;
				const result = await provider.reconcileCheckout({
					reference: checkout.reference,
					sessionId: candidateSessionId ?? checkout.sessionId,
					recovery,
				});
				if (result.lifecycle === "open" && result.url)
					checkoutUrl = hostedUrl(result.url);
				if (result.sessionId)
					await store.attachCheckout(
						provider.id,
						checkout.reference,
						result.sessionId,
					);
				await record({
					provider: provider.id,
					id: `reconcile:${reference}:${crypto.randomUUID()}`,
					type: "checkout.reconciled",
					occurredAt: now(),
					effect: "sync",
					lifecycle: result.lifecycle,
					lookup: {
						checkoutReference: checkout.reference,
						sessionId: result.sessionId,
						subscriptionId: result.subscriptionId,
						customerId: result.customerId,
					},
				});
			} else if (!canReadSubscription)
				throw new PaymentError(
					"RETRY",
					"Provider reconciliation unavailable; verified provider support resolution required",
				);
			const current = await snapshot(await owned(user, reference));
			const result = status(current);
			// Return a fresh verified URL only for this owner's still-open purchase.
			// Never store it in a ledger/history projection or resurrect a terminal flow.
			return {
				...result,
				...(checkoutUrl &&
				result.lifecycle === "open" &&
				result.state === "pending" &&
				!result.paid &&
				!result.reconciliationRequired &&
				!current.references.subscriptionId
					? { checkoutUrl }
					: {}),
			};
		},
		async handleWebhook(rawBody: string, headers: Headers) {
			await assertNamespace();
			let event: PaymentEvent | undefined;
			try {
				event = await provider.verifyWebhook(rawBody, headers);
				return await record(event);
			} catch (error) {
				const code = error instanceof PaymentError ? error.code : "INTERNAL";
				const eventId =
					event?.id ??
					(error instanceof PaymentError ? error.details?.eventId : undefined);
				logDiagnostic(error, {
					operation: "payment.webhook",
					provider: provider.id,
					eventId,
				});
				// Only a provider-verified ID can enter the durable retry index. Signature failures
				// never persist untrusted identifiers or bodies.
				if (eventId)
					try {
						await store.recordWebhookFailure?.({
							provider: provider.id,
							eventId,
							code,
							at: now(),
						});
					} catch {
						/* D1 failure remains diagnosable from the safe log. */
					}
				throw error;
			}
		},
	};
}
export async function paymentWebhookResponse(
	request: Request,
	options: {
		enabled: boolean;
		configuredProvider?: string;
		routeProvider: string;
		service?: ReturnType<typeof createPaymentService>;
		context?: DiagnosticContext;
	},
): Promise<Response> {
	// An off switch for new checkout must never acknowledge and discard existing billing events.
	if (options.configuredProvider !== options.routeProvider)
		return new Response("Not found", { status: 404 });
	if (request.method !== "POST")
		return new Response("Method not allowed", { status: 405 });
	if (!options.service)
		return new Response("Payment configuration unavailable; retry later", {
			status: 503,
		});
	try {
		const contentLength = Number(request.headers.get("content-length"));
		if (contentLength > 1_048_576)
			return new Response("Payload too large", { status: 413 });
		const reader = request.body?.getReader();
		const decoder = new TextDecoder();
		let total = 0;
		let body = "";
		if (reader) {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				total += chunk.value.byteLength;
				if (total > 1_048_576) {
					await reader.cancel();
					return new Response("Payload too large", { status: 413 });
				}
				body += decoder.decode(chunk.value, { stream: true });
			}
			body += decoder.decode();
		}
		await options.service.handleWebhook(body, request.headers);
		return new Response("OK", { status: 200 });
	} catch (error) {
		logDiagnostic(error, options.context ?? { operation: "payment.webhook" });
		if (error instanceof PaymentError && error.code === "INVALID_SIGNATURE")
			return new Response("Invalid webhook", { status: 400 });
		return new Response("Webhook processing failed; retry later", {
			status: 500,
			headers: options.context?.requestId
				? { "X-Request-ID": options.context.requestId }
				: {},
		});
	}
}
