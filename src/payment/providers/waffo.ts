import {
	WaffoPancake,
	verifyWebhook,
	type WebhookPublicKeys,
} from "@waffo/pancake-ts";
import {
	PaymentError,
	type PaymentEvent,
	type PaymentMode,
	type PaymentAdapter,
} from "../types";
import {
	hostedUrl,
	id,
	object,
	required,
	requiredField,
	string,
	timestamp,
} from "../utils";
export interface WaffoConfig {
	merchantId?: string;
	privateKey?: string;
	mode: PaymentMode;
	fetch?: typeof fetch;
	/** Required expected store for signed webhooks; platform signing keys are shared across stores. */
	storeId?: string;
	/** Explicit SSO opt-in; the default remains the documented Magic Link portal. */
	portalSso?: boolean;
	/** Optional key rotation / deterministic signed-fixture tests. Defaults to official embedded keys. */
	webhookPublicKeys?: WebhookPublicKeys;
}
export function createWaffoProvider(config: WaffoConfig): PaymentAdapter {
	const merchantId = required(config.merchantId, "WAFFO_MERCHANT_ID");
	const storeId = required(config.storeId, "WAFFO_STORE_ID");
	const privateKey = required(config.privateKey, "WAFFO_PRIVATE_KEY").replace(
		/\\n/g,
		"\n",
	);
	const environment = config.mode === "live" ? "prod" : "test";
	const transport: typeof fetch = async (input, init) => {
		const response = await (config.fetch ?? fetch)(input, {
			...init,
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok)
			throw new PaymentError(
				"PROVIDER_ERROR",
				`Waffo returned HTTP ${response.status}`,
			);
		return response;
	};
	const client = new WaffoPancake({
		merchantId,
		privateKey,
		environment,
		fetch: transport,
	});
	return {
		id: "waffo",
		requiresCustomerId: false,
		hostsPostCheckoutPage: true,
		async createCheckout(input) {
			const success = new URL(input.successUrl);
			success.searchParams.set("checkout_id", input.reference);
			const response = await client.checkout.authenticated.create(
				{
					productId: input.plan.priceId,
					currency: input.plan.currency.toUpperCase(),
					withTrial: input.plan.trialPeriodDays ? true : undefined,
					buyerIdentity: input.user.id,
					buyerEmail: input.user.email,
					successUrl: success.toString(),
					orderMerchantExternalId: input.reference,
					metadata: {
						checkoutReference: input.reference,
						userId: input.user.id,
						planId: input.plan.id,
						priceId: input.plan.priceId,
					},
				},
				{ idempotencyKey: input.reference },
			);
			// Never expose or persist the separate JWT; redirect URL itself is short-lived and must not be logged.
			return {
				sessionId: requiredField(response.sessionId, "session id"),
				url: hostedUrl(response.checkoutUrl),
			};
		},
		async createPortal(input) {
			if (!config.portalSso)
				return "https://pancake.waffo.ai/consumer/portal/login";
			const response = await client.auth.createCustomerPortalLink({
				storeId,
				buyerIdentity: input.user.id,
			});
			return hostedUrl(response.portalUrl);
		},
		async cancelSubscription(input) {
			if (!input.atPeriodEnd)
				throw new PaymentError(
					"INVALID_INPUT",
					"Waffo controls cancellation timing; immediate cancellation is unsupported",
				);
			await client.orders.cancelSubscription({ orderId: input.subscriptionId });
		},
		async verifyWebhook(rawBody, headers) {
			const signature = headers.get("x-waffo-signature");
			if (!signature || !rawBody)
				throw new PaymentError(
					"INVALID_SIGNATURE",
					"Missing Waffo signed payload",
				);
			let verified: Record<string, unknown>;
			try {
				const event = verifyWebhook(rawBody, signature, {
					environment,
					publicKeys: config.webhookPublicKeys,
					toleranceMs: 45 * 60 * 1000,
					futureToleranceMs: 60_000,
				});
				// Explicit payload mode check too: key selection alone is not the application boundary.
				if (event.mode !== environment)
					throw new Error("Waffo environment mismatch");
				// Waffo signs all stores in an environment with the same platform key.
				// Only the signed top-level storeId establishes ownership, never metadata
				// or an unsigned header. Compare exactly before normalizing/correlating.
				if (typeof event.storeId !== "string" || event.storeId !== storeId)
					throw new Error("Waffo store mismatch");
				verified = event as unknown as Record<string, unknown>;
			} catch {
				throw new PaymentError(
					"INVALID_SIGNATURE",
					"Invalid, stale, wrong-environment, or wrong-store Waffo webhook",
				);
			}
			return normalizeWaffoEvent(verified);
		},
	};
}
/** Waffo service bounds are calendar dates (or ISO timestamps), not a year/locale string. */
function serviceTimestamp(value: unknown): number | undefined {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
		return undefined;
	const parsed = timestamp(value);
	if (parsed === undefined) return undefined;
	// Date.parse otherwise silently normalizes impossible dates such as February 31.
	const calendar = value.slice(0, 10);
	const calendarTime = timestamp(calendar);
	if (
		!calendarTime ||
		new Date(calendarTime).toISOString().slice(0, 10) !== calendar
	)
		return undefined;
	return parsed;
}
export function normalizeWaffoEvent(
	payload: Record<string, unknown>,
): PaymentEvent {
	const data = object(payload.data);
	const type = requiredField(payload.eventType, "event type");
	const metadata =
		type === "subscription.plan_changed"
			? object(data.productMetadata)
			: { ...object(data.orderMetadata), ...object(data.productMetadata) };
	const event: PaymentEvent = {
		provider: "waffo",
		// Waffo reuses an order id for distinct event types. Both fields form its dedupe identity.
		id: `${type}:${requiredField(payload.eventId ?? payload.id, "event id")}`,
		type,
		occurredAt: timestamp(payload.timestamp) ?? 0,
		effect: "ignore",
		lookup: {
			checkoutReference:
				string(data.orderMerchantExternalId) ??
				string(object(data.orderMetadata).checkoutReference),
			orderId: id(data.orderId),
			subscriptionId: type.startsWith("subscription.")
				? id(data.orderId)
				: undefined,
		},
		priceId: string(metadata.priceId) ?? string(data.productId),
		planId: string(metadata.planId),
	};
	if (!event.occurredAt)
		throw new PaymentError(
			"INVALID_SIGNATURE",
			"Missing Waffo event timestamp",
		);
	if (type === "order.completed") {
		event.effect = "grant";
		event.state = "active";
	} else if (
		[
			"subscription.activated",
			"subscription.renewed",
			"subscription.recovered",
			"subscription.plan_changed",
		].includes(type)
	) {
		event.effect = "grant";
		event.state = "active";
		event.periodStart = serviceTimestamp(data.currentPeriodStart);
		event.periodEnd = serviceTimestamp(data.currentPeriodEnd);
		event.cancelAtPeriodEnd = false;
		// An applied plan change can reset to a shorter paid window. Missing or
		// malformed bounds must retry, not silently retain the old annual grant.
		if (
			(data.currentPeriodStart != null && !event.periodStart) ||
			(data.currentPeriodEnd != null && !event.periodEnd) ||
			(event.periodStart !== undefined &&
				event.periodEnd !== undefined &&
				event.periodStart >= event.periodEnd) ||
			(type === "subscription.plan_changed" &&
				(!event.periodStart || !event.periodEnd))
		)
			throw new PaymentError(
				"RETRY",
				"Invalid or missing Waffo paid service interval",
			);
		if (type === "subscription.plan_changed" && !event.priceId && !event.planId)
			throw new PaymentError(
				"RETRY",
				"Configure product metadata with planId or priceId before handling a plan change",
			);
	} else if (type === "subscription.payment_succeeded")
		event.effect = "receipt";
	else if (
		type === "subscription.canceling" ||
		type === "subscription.uncanceled"
	) {
		event.effect = "sync";
		event.cancelAtPeriodEnd = type === "subscription.canceling";
		event.state = "active";
		event.periodStart = serviceTimestamp(data.currentPeriodStart);
		event.periodEnd = serviceTimestamp(data.currentPeriodEnd);
	} else if (type === "subscription.canceled") {
		event.effect = "revoke";
		event.state = "canceled";
	} else if (type === "subscription.past_due") {
		event.effect = "sync";
		event.state = "past_due";
	} else if (type === "refund.succeeded") {
		event.effect = "revoke";
		event.state = "refunded";
	}
	// refund.failed and failed/scheduled plan changes cannot alter existing access.
	return event;
}
