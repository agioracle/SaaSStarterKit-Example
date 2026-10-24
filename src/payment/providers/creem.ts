import {
	PaymentError,
	type PaymentEvent,
	type PaymentMode,
	type PaymentAdapter,
} from "../types";
import {
	equalHex,
	hmacHex,
	hostedUrl,
	id,
	object,
	parsePayload,
	required,
	requiredField,
	string,
	timestamp,
} from "../utils";
export interface CreemConfig {
	apiKey?: string;
	webhookSecret?: string;
	mode: PaymentMode;
	fetch?: typeof fetch;
	/** Explicit opt-in safety extension; original reference leaves refund/dispute unhandled. */
	revokeOnRefundOrDispute?: boolean;
	now?: () => number;
}
export function createCreemProvider(config: CreemConfig): PaymentAdapter {
	const key = required(config.apiKey, "CREEM_API_KEY");
	const secret = required(config.webhookSecret, "CREEM_WEBHOOK_SECRET");
	const base =
		config.mode === "live"
			? "https://api.creem.io"
			: "https://test-api.creem.io";
	const request = async (path: string, body?: Record<string, unknown>) => {
		let response: Response;
		try {
			response = await (config.fetch ?? fetch)(`${base}/v1/${path}`, {
				method: body ? "POST" : "GET",
				headers: { "x-api-key": key, "Content-Type": "application/json" },
				body: body ? JSON.stringify(body) : undefined,
				redirect: "error",
				signal: AbortSignal.timeout(15_000),
			});
		} catch {
			throw new PaymentError(
				"PROVIDER_ERROR",
				"Creem request outcome is unknown",
				{ outcome: "unknown" },
			);
		}
		let result: Record<string, unknown>;
		try {
			result = object(await response.json());
		} catch {
			throw new PaymentError("PROVIDER_ERROR", "Invalid Creem JSON response", {
				outcome:
					response.status === 401 || response.status === 403
						? "not_created"
						: "unknown",
				upstreamStatus: response.status,
			});
		}
		if (!response.ok)
			throw new PaymentError(
				"PROVIDER_ERROR",
				`Creem returned HTTP ${response.status}`,
				{
					// No documented request_id retention guarantee: conflicts, validation
					// responses without definite pre-execution proof, and 5xx stay unknown.
					outcome:
						response.status === 401 || response.status === 403
							? "not_created"
							: "unknown",
					upstreamStatus: response.status,
				},
			);
		return result;
	};
	const assertMode = (data: Record<string, unknown>) => {
		const mode = string(data.mode);
		if (
			config.mode === "live"
				? mode !== "prod"
				: mode !== "test" && mode !== "sandbox"
		)
			throw new PaymentError("RETRY", "Creem environment mismatch");
	};
	return {
		id: "creem",
		hostsPostCheckoutPage: true,
		async createCheckout(input) {
			const success = new URL(input.successUrl);
			success.searchParams.set("request_id", input.reference);
			const response = await request("checkouts", {
				product_id: input.plan.priceId,
				request_id: input.reference,
				customer: input.customerId
					? { id: input.customerId }
					: { email: input.user.email },
				success_url: success.toString(),
				metadata: {
					checkoutReference: input.reference,
					userId: input.user.id,
					planId: input.plan.id,
				},
			});
			return {
				sessionId: requiredField(response.id, "checkout id"),
				url: hostedUrl(response.checkout_url),
				customerId: id(response.customer) ?? input.customerId,
			};
		},
		async reconcileCheckout(input) {
			// A request_id is a tracking key, not a documented indefinite replay
			// guarantee. A lost create response must be recovered by verified ID.
			if (!input.sessionId) return { lifecycle: "unknown" };
			const response = await request(
				`checkouts?checkout_id=${encodeURIComponent(input.sessionId)}`,
			);
			assertMode(response);
			const requestReference = string(response.request_id);
			const metadataReference = string(
				object(response.metadata).checkoutReference,
			);
			if (
				response.id !== input.sessionId ||
				(!requestReference && !metadataReference) ||
				(requestReference && requestReference !== input.reference) ||
				(metadataReference && metadataReference !== input.reference)
			)
				throw new PaymentError("RETRY", "Creem checkout identity mismatch");
			const lifecycle =
				response.status === "completed"
					? "completed"
					: response.status === "expired"
						? "expired"
						: response.status === "pending" || response.status === "processing"
							? "open"
							: "unknown";
			return {
				lifecycle,
				sessionId: input.sessionId,
				customerId: id(response.customer),
				subscriptionId: id(response.subscription),
				...(lifecycle === "open" && response.checkout_url
					? { url: hostedUrl(response.checkout_url) }
					: {}),
			};
		},
		async reconcileSubscription(subscriptionId) {
			const response = await request(
				`subscriptions?subscription_id=${encodeURIComponent(subscriptionId)}`,
			);
			assertMode(response);
			if (response.id !== subscriptionId)
				throw new PaymentError("RETRY", "Creem subscription identity mismatch");
			const observedAt = config.now?.() ?? Date.now();
			const event = normalizeCreemEvent({
				id: `reconcile:creem:${crypto.randomUUID()}`,
				eventType: "subscription.update",
				created_at: observedAt,
				object: response,
			});
			return {
				...event,
				type: "subscription.reconciled",
				occurredAt: observedAt,
			};
		},
		async createPortal(input) {
			if (!input.customerId)
				throw new PaymentError(
					"NOT_FOUND",
					"No billing customer for this account",
				);
			const response = await request("customers/billing", {
				customer_id: input.customerId,
			});
			return hostedUrl(response.customer_portal_link);
		},
		async cancelSubscription(input) {
			await request(
				`subscriptions/${encodeURIComponent(input.subscriptionId)}/cancel`,
				{
					mode: input.atPeriodEnd ? "scheduled" : "immediate",
					onExecute: "cancel",
				},
			);
		},
		async verifyWebhook(rawBody, headers) {
			const signature = headers.get("creem-signature");
			if (!signature || !equalHex(await hmacHex(secret, rawBody), signature))
				throw new PaymentError("INVALID_SIGNATURE", "Invalid Creem signature");
			const payload = parsePayload(rawBody);
			const mode = string(object(payload.object).mode);
			if (
				mode &&
				(config.mode === "live"
					? mode !== "prod" && mode !== "live"
					: mode !== "test" && mode !== "local" && mode !== "sandbox")
			)
				throw new PaymentError(
					"INVALID_SIGNATURE",
					"Creem environment mismatch",
				);
			try {
				return normalizeCreemEvent(
					payload,
					config.revokeOnRefundOrDispute ?? false,
				);
			} catch (error) {
				if (!(error instanceof PaymentError)) throw error;
				// Expose only the verified event identity for durable retry diagnostics.
				throw new PaymentError(error.code, error.message, {
					...error.details,
					eventId: string(payload.id),
				});
			}
		},
	};
}
export function normalizeCreemEvent(
	payload: Record<string, unknown>,
	revokeOnRefundOrDispute = false,
): PaymentEvent {
	const data = object(payload.object);
	const type = requiredField(payload.eventType, "event type");
	const order = object(data.order);
	const subscription = object(data.subscription);
	const metadata = {
		...object(subscription.metadata),
		...object(data.metadata),
	};
	const event: PaymentEvent = {
		provider: "creem",
		id: requiredField(payload.id, "event id"),
		type,
		occurredAt: timestamp(payload.created_at) ?? 0,
		effect: "ignore",
		lookup: {
			checkoutReference:
				string(data.request_id) ?? string(metadata.checkoutReference),
			sessionId: type === "checkout.completed" ? id(data.id) : undefined,
			subscriptionId: type.startsWith("subscription.")
				? id(data.id)
				: id(data.subscription),
			customerId: id(data.customer),
			orderId: id(data.order),
		},
		priceId: id(data.product),
	};
	if (!event.occurredAt)
		throw new PaymentError(
			"INVALID_SIGNATURE",
			"Missing Creem event timestamp",
		);
	if (type === "checkout.completed") {
		event.lifecycle = "completed";
		if (
			!id(data.subscription) &&
			object(data.product).billing_type === "onetime" &&
			order.status === "paid"
		) {
			event.effect = "grant";
			event.state = "active";
		} else event.effect = "sync";
	} else if (type === "subscription.paid") {
		event.effect = "grant";
		event.state = "active";
		event.periodStart = timestamp(data.current_period_start_date);
		event.periodEnd = timestamp(data.current_period_end_date);
	} else if (type === "subscription.active" || type === "subscription.update") {
		event.effect = "sync";
		const status = string(data.status);
		const states: Record<string, PaymentEvent["state"]> = {
			active: "active",
			scheduled_cancel: "active",
			past_due: "past_due",
			unpaid: "unpaid",
			paused: "unpaid",
			canceled: "canceled",
			trialing: "trialing",
		};
		event.state = states[status ?? ""];
		if (!event.state)
			throw new PaymentError("RETRY", "Unrecognized Creem subscription status");
		// A resumed active snapshot explicitly clears an older scheduled cancel.
		event.cancelAtPeriodEnd = status === "scheduled_cancel";
		if (event.state === "canceled") event.effect = "revoke";
		event.periodStart = timestamp(data.current_period_start_date);
		event.periodEnd = timestamp(data.current_period_end_date);
	} else if (type === "subscription.scheduled_cancel") {
		event.effect = "sync";
		event.cancelAtPeriodEnd = true;
	} else if (type === "subscription.canceled") {
		event.effect = "revoke";
		event.state = "canceled";
	} else if (
		type === "subscription.past_due" ||
		type === "subscription.expired"
	) {
		event.effect = "sync";
		event.state = "past_due";
	} else if (type === "subscription.unpaid" || type === "subscription.paused") {
		event.effect = "sync";
		event.state = "unpaid";
	} else if (type === "subscription.trialing") {
		event.effect = "sync";
		event.state = "trialing";
		event.periodEnd = timestamp(data.current_period_end_date);
	} else if (
		revokeOnRefundOrDispute &&
		((type === "refund.created" && data.status === "succeeded") ||
			type === "dispute.created")
	) {
		event.effect = "revoke";
		event.state = type === "refund.created" ? "refunded" : "disputed";
		event.lookup.orderId = id(data.order) ?? id(object(data.transaction).order);
		event.lookup.subscriptionId =
			id(data.subscription) ?? id(object(data.transaction).subscription);
	}
	return event;
}
