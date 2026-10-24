import {
	PaymentError,
	type PaymentEvent,
	type PaymentMode,
	type PaymentAdapter,
	type ProviderCheckoutInput,
} from "../types";
import {
	array,
	equalHex,
	hmacHex,
	hostedUrl,
	id,
	object,
	parsePayload,
	required,
	requiredField,
	signatureParts,
	string,
	timestamp,
} from "../utils";
export interface StripeConfig {
	secretKey?: string;
	webhookSecret?: string;
	mode: PaymentMode;
	/** Pin to the snapshot-event version registered for your webhook endpoint. */
	apiVersion?: string;
	fetch?: typeof fetch;
	now?: () => number;
}
export function createStripeProvider(config: StripeConfig): PaymentAdapter {
	const key = required(config.secretKey, "STRIPE_SECRET_KEY");
	const secret = required(config.webhookSecret, "STRIPE_WEBHOOK_SECRET");
	const transport = config.fetch ?? fetch;
	const request = async (
		path: string,
		data: URLSearchParams,
		method = "POST",
		idempotencyKey?: string,
	) => {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/x-www-form-urlencoded",
		};
		if (config.apiVersion) headers["Stripe-Version"] = config.apiVersion;
		if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
		let response: Response;
		try {
			response = await transport(`https://api.stripe.com/v1/${path}`, {
				method,
				headers,
				body: method === "DELETE" || method === "GET" ? undefined : data,
				redirect: "error",
				signal: AbortSignal.timeout(15_000),
			});
		} catch {
			throw new PaymentError(
				"PROVIDER_ERROR",
				"Stripe request outcome is unknown",
				{ outcome: "unknown" },
			);
		}
		let result: Record<string, unknown>;
		try {
			result = object(await response.json());
		} catch {
			throw new PaymentError("PROVIDER_ERROR", "Invalid Stripe JSON response", {
				outcome:
					response.status === 401 || response.status === 403
						? "not_created"
						: "unknown",
				upstreamStatus: response.status,
			});
		}
		if (!response.ok) {
			const error = object(result.error);
			// Only definite pre-execution validation failures may release a checkout.
			// In particular, idempotency conflicts and all 5xx/network failures stay unknown.
			const invalidParameters =
				response.status === 400 &&
				error.type === "invalid_request_error" &&
				[
					"parameter_missing",
					"parameter_unknown",
					"parameter_invalid_empty",
					"parameter_invalid_integer",
					"parameter_invalid_string_blank",
					"parameter_invalid_string_empty",
					"resource_missing",
					"url_invalid",
				].includes(string(error.code) ?? "");
			throw new PaymentError(
				"PROVIDER_ERROR",
				`Stripe returned HTTP ${response.status}`,
				{
					outcome:
						invalidParameters ||
						response.status === 401 ||
						response.status === 403
							? "not_created"
							: "unknown",
					upstreamStatus: response.status,
				},
			);
		}
		return result;
	};
	const createSession = async (input: ProviderCheckoutInput) => {
		const success = new URL(input.successUrl);
		success.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
		const params = new URLSearchParams({
			mode: input.plan.kind === "subscription" ? "subscription" : "payment",
			"line_items[0][price]": input.plan.priceId,
			"line_items[0][quantity]": "1",
			success_url: success
				.toString()
				.replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}"),
			cancel_url: input.cancelUrl,
			client_reference_id: input.reference,
			"metadata[checkoutReference]": input.reference,
			"metadata[userId]": input.user.id,
			"metadata[planId]": input.plan.id,
		});
		if (input.customerId) params.set("customer", input.customerId);
		else params.set("customer_email", input.user.email);
		if (input.plan.allowPromotionCodes !== undefined)
			params.set(
				"allow_promotion_codes",
				String(input.plan.allowPromotionCodes),
			);
		if (input.plan.kind === "subscription") {
			if (input.plan.trialPeriodDays !== undefined) {
				if (
					!Number.isSafeInteger(input.plan.trialPeriodDays) ||
					input.plan.trialPeriodDays < 1 ||
					input.plan.trialPeriodDays > 730
				)
					throw new PaymentError(
						"CONFIGURATION",
						"Invalid Stripe trial period",
						{ outcome: "not_created" },
					);
				params.set(
					"subscription_data[trial_period_days]",
					String(input.plan.trialPeriodDays),
				);
			}
			params.set(
				"subscription_data[metadata][checkoutReference]",
				input.reference,
			);
			params.set("subscription_data[metadata][userId]", input.user.id);
		} else {
			if (!input.customerId) params.set("customer_creation", "always");
			params.set("invoice_creation[enabled]", "true");
			params.set(
				"invoice_creation[invoice_data][metadata][checkoutReference]",
				input.reference,
			);
			params.set(
				"payment_intent_data[metadata][checkoutReference]",
				input.reference,
			);
		}
		return request("checkout/sessions", params, "POST", input.reference);
	};
	const assertMode = (data: Record<string, unknown>) => {
		if (data.livemode !== (config.mode === "live"))
			throw new PaymentError("RETRY", "Stripe environment mismatch");
	};
	return {
		id: "stripe",
		async ensureCustomer(user) {
			const response = await request(
				"customers",
				new URLSearchParams({
					email: user.email,
					"metadata[userId]": user.id,
				}),
				"POST",
				`edgekit-customer:${user.id}`,
			);
			return requiredField(response.id, "customer id");
		},
		async createCheckout(input) {
			const response = await createSession(input);
			return {
				sessionId: requiredField(response.id, "checkout id"),
				url: hostedUrl(response.url),
				customerId: id(response.customer) ?? input.customerId,
			};
		},
		async reconcileCheckout(input) {
			let sessionId = input.sessionId;
			if (!sessionId) {
				// The service supplies only the immutable original request within the
				// 23-hour safety window. Never reconstruct it from current user/plan data.
				if (!input.recovery) return { lifecycle: "unknown" };
				if (input.recovery.reference !== input.reference)
					throw new PaymentError(
						"INVALID_INPUT",
						"Checkout recovery reference mismatch",
					);
				sessionId = requiredField(
					(await createSession(input.recovery)).id,
					"checkout id",
				);
			}
			const response = await request(
				`checkout/sessions/${encodeURIComponent(sessionId)}`,
				new URLSearchParams(),
				"GET",
			);
			assertMode(response);
			if (
				response.id !== sessionId ||
				response.client_reference_id !== input.reference ||
				object(response.metadata).checkoutReference !== input.reference ||
				!["subscription", "payment"].includes(string(response.mode) ?? "") ||
				(input.recovery &&
					response.mode !==
						(input.recovery.plan.kind === "subscription"
							? "subscription"
							: "payment"))
			)
				throw new PaymentError("RETRY", "Stripe checkout identity mismatch");
			const lifecycle =
				response.status === "complete"
					? "completed"
					: response.status === "expired"
						? "expired"
						: response.status === "open"
							? "open"
							: "unknown";
			return {
				lifecycle,
				sessionId,
				customerId: id(response.customer),
				subscriptionId: id(response.subscription),
				...(lifecycle === "open" && response.url
					? { url: hostedUrl(response.url) }
					: {}),
			};
		},
		async reconcileSubscription(subscriptionId) {
			const response = await request(
				`subscriptions/${encodeURIComponent(subscriptionId)}`,
				new URLSearchParams(),
				"GET",
			);
			assertMode(response);
			if (response.id !== subscriptionId)
				throw new PaymentError(
					"RETRY",
					"Stripe subscription identity mismatch",
				);
			const observedAt = config.now?.() ?? Date.now();
			const event = normalizeStripeEvent({
				id: `reconcile:stripe:${crypto.randomUUID()}`,
				type: "customer.subscription.updated",
				created: observedAt / 1000,
				data: { object: response },
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
			const response = await request(
				"billing_portal/sessions",
				new URLSearchParams({
					customer: input.customerId,
					return_url: input.returnUrl,
				}),
			);
			return hostedUrl(response.url);
		},
		async cancelSubscription(input) {
			await request(
				`subscriptions/${encodeURIComponent(input.subscriptionId)}`,
				new URLSearchParams({ cancel_at_period_end: "true" }),
				input.atPeriodEnd ? "POST" : "DELETE",
			);
		},
		async verifyWebhook(rawBody, headers) {
			const signature = headers.get("stripe-signature");
			if (!signature)
				throw new PaymentError("INVALID_SIGNATURE", "Missing Stripe signature");
			const parts = signatureParts(signature);
			const times = parts.get("t") ?? [];
			const time = Number(times[0]);
			if (
				times.length !== 1 ||
				!Number.isSafeInteger(time) ||
				Math.abs((config.now?.() ?? Date.now()) - time * 1000) > 300_000
			)
				throw new PaymentError(
					"INVALID_SIGNATURE",
					"Invalid or stale Stripe signature",
				);
			const expected = await hmacHex(secret, `${times[0]}.${rawBody}`);
			if (!(parts.get("v1") ?? []).some((value) => equalHex(expected, value)))
				throw new PaymentError("INVALID_SIGNATURE", "Invalid Stripe signature");
			const payload = parsePayload(rawBody);
			if (payload.livemode !== (config.mode === "live"))
				throw new PaymentError(
					"INVALID_SIGNATURE",
					"Stripe environment mismatch",
				);
			try {
				return normalizeStripeEvent(payload);
			} catch (error) {
				if (!(error instanceof PaymentError)) throw error;
				// Correlation for retry diagnostics is safe only after signature/mode
				// validation. Never include the raw provider body in the error.
				throw new PaymentError(error.code, error.message, {
					...error.details,
					eventId: string(payload.id),
				});
			}
		},
	};
}
/** The supported entitlement model is a single recurring item. A proration
 * credit can precede the new price; unrelated invoice lines cannot lend it a period.
 * https://docs.stripe.com/billing/subscriptions/prorations */
function stripeLine(line: Record<string, unknown>) {
	const details = object(object(line.parent).subscription_item_details);
	return {
		line,
		priceId:
			id(line.price) ?? id(object(object(line.pricing).price_details).price),
		subscriptionId: id(line.subscription) ?? id(details.subscription),
		itemId: id(line.subscription_item) ?? id(details.subscription_item),
		recurring:
			line.type === "subscription" ||
			object(line.parent).type === "subscription_item_details" ||
			Boolean(
				id(line.subscription) ||
					id(details.subscription) ||
					id(line.subscription_item) ||
					id(details.subscription_item) ||
					object(line.price).recurring,
			),
		proration: line.proration === true || details.proration === true,
	};
}
function selectInvoiceLine(
	data: Record<string, unknown>,
	subscriptionId?: string,
) {
	const collection = object(data.lines);
	if (collection.has_more === true)
		throw new PaymentError(
			"RETRY",
			"Stripe invoice lines are incomplete; reconciliation required",
		);
	const lines = array(collection.data).map(object).map(stripeLine);
	const recurring = lines.filter((line) => line.recurring);
	if (!subscriptionId && recurring.length === 0) {
		if (lines.length > 1)
			throw new PaymentError("RETRY", "Ambiguous Stripe invoice prices");
		return lines[0];
	}
	if (
		recurring.some(
			(line) =>
				typeof line.line.amount !== "number" ||
				!Number.isFinite(line.line.amount),
		)
	)
		throw new PaymentError(
			"RETRY",
			"Stripe recurring invoice amount is missing",
		);
	const nonnegative = recurring.filter((line) => Number(line.line.amount) >= 0);
	if (
		new Set(nonnegative.map((line) => line.itemId).filter(Boolean)).size > 1 ||
		new Set(nonnegative.map((line) => line.subscriptionId).filter(Boolean))
			.size > 1 ||
		nonnegative.some(
			(line) =>
				subscriptionId &&
				line.subscriptionId &&
				line.subscriptionId !== subscriptionId,
		)
	)
		throw new PaymentError(
			"RETRY",
			"Multiple Stripe subscription items require reconciliation",
		);
	const regular = nonnegative.filter((line) => !line.proration);
	const candidates = regular.length ? regular : nonnegative;
	if (candidates.length !== 1 || !candidates[0].priceId)
		throw new PaymentError(
			"RETRY",
			"Ambiguous Stripe recurring invoice prices or periods",
		);
	const selected = candidates[0];
	const start = timestamp(object(selected.line.period).start, true);
	const end = timestamp(object(selected.line.period).end, true);
	if (!start || !end || start >= end)
		throw new PaymentError(
			"RETRY",
			"Stripe recurring invoice period is incomplete",
		);
	return selected;
}
/** Snapshot event normalizer. invoice.paid is the only ordinary paid-access authority. */
export function normalizeStripeEvent(
	payload: Record<string, unknown>,
): PaymentEvent {
	const data = object(object(payload.data).object);
	const type = requiredField(payload.type, "event type");
	const subscriptionDetails = object(object(data.parent).subscription_details);
	const legacySubscriptionDetails = object(data.subscription_details);
	const metadata = {
		...object(legacySubscriptionDetails.metadata),
		...object(subscriptionDetails.metadata),
		...object(data.metadata),
	};
	const subscriptionId =
		id(data.subscription) ??
		id(subscriptionDetails.subscription) ??
		(type.startsWith("customer.subscription.") ? id(data.id) : undefined);
	const event: PaymentEvent = {
		provider: "stripe",
		id: requiredField(payload.id, "event id"),
		type,
		occurredAt: timestamp(payload.created, true) ?? 0,
		effect: "ignore",
		lookup: {
			checkoutReference:
				string(metadata.checkoutReference) ??
				(type.startsWith("checkout.session.")
					? string(data.client_reference_id)
					: undefined),
			customerId: id(data.customer),
			subscriptionId,
			invoiceId: type.startsWith("invoice.") ? id(data.id) : id(data.invoice),
			paymentIntentId: id(data.payment_intent),
			sessionId: type.startsWith("checkout.session.") ? id(data.id) : undefined,
		},
	};
	if (!event.occurredAt)
		throw new PaymentError(
			"INVALID_SIGNATURE",
			"Missing Stripe event timestamp",
		);
	if (
		type === "checkout.session.completed" ||
		type === "checkout.session.async_payment_succeeded"
	) {
		event.effect = "sync";
		event.lifecycle = "completed";
	} else if (type === "checkout.session.expired") {
		event.effect = "sync";
		event.lifecycle = "expired";
	} else if (type === "invoice.paid") {
		if (data.paid !== true && data.status !== "paid")
			throw new PaymentError(
				"INVALID_SIGNATURE",
				"Paid invoice has no paid status",
			);
		event.effect = "grant";
		event.state = "active";
		const selected = selectInvoiceLine(data, subscriptionId);
		if (selected) {
			event.priceId = selected.priceId;
			event.periodStart = timestamp(object(selected.line.period).start, true);
			event.periodEnd = timestamp(object(selected.line.period).end, true);
			event.lookup.subscriptionItemId = selected.itemId;
			event.lookup.subscriptionId = subscriptionId ?? selected.subscriptionId;
		}
	} else if (
		type === "customer.subscription.updated" ||
		type === "customer.subscription.created"
	) {
		event.effect = "sync";
		const states: Record<string, PaymentEvent["state"]> = {
			active: "active",
			trialing: "trialing",
			past_due: "past_due",
			unpaid: "unpaid",
			canceled: "canceled",
			paused: "unpaid",
			incomplete: "pending",
			incomplete_expired: "canceled",
		};
		event.state = states[string(data.status) ?? ""];
		if (!event.state)
			throw new PaymentError(
				"RETRY",
				"Unrecognized Stripe subscription status",
			);
		event.cancelAtPeriodEnd = data.cancel_at_period_end === true;
		if (event.state === "canceled") {
			event.effect = "revoke";
			return event;
		}
		const collection = object(data.items);
		const items = array(collection.data).map(object);
		if (
			collection.has_more === true ||
			items.length !== 1 ||
			!id(items[0].price)
		)
			throw new PaymentError(
				"RETRY",
				"Stripe subscription requires one complete price item",
			);
		const item = items[0];
		// New API versions put both period boundaries on the item; legacy versions
		// put both on the subscription. Never mix boundaries from separate objects.
		const period =
			item.current_period_start !== undefined ||
			item.current_period_end !== undefined
				? item
				: data;
		event.periodStart = timestamp(period.current_period_start, true);
		event.periodEnd =
			timestamp(period.current_period_end, true) ??
			(event.state === "trialing"
				? timestamp(data.trial_end, true)
				: undefined);
		event.priceId = id(item.price);
		event.lookup.subscriptionItemId = id(item.id);
	} else if (type === "customer.subscription.deleted") {
		event.effect = "revoke";
		event.state = "canceled";
	} else if (type === "invoice.payment_failed") {
		event.effect = "sync";
		event.state = "past_due";
		try {
			const selected = selectInvoiceLine(data, subscriptionId);
			if (selected) {
				event.periodStart = timestamp(object(selected.line.period).start, true);
				event.periodEnd = timestamp(object(selected.line.period).end, true);
				event.lookup.subscriptionItemId = selected.itemId;
			}
		} catch (error) {
			// Missing/ambiguous invoice coverage is not permission to ignore a
			// payment failure. Keep the conservative status without guessed dates.
			if (!(error instanceof PaymentError) || error.code !== "RETRY")
				throw error;
		}
	} else if (
		type === "charge.refunded" &&
		(data.refunded === true ||
			(typeof data.amount_refunded === "number" &&
				typeof data.amount === "number" &&
				data.amount_refunded >= data.amount))
	) {
		event.effect = "revoke";
		event.state = "refunded";
	} else if (type === "charge.dispute.created") {
		event.effect = "revoke";
		event.state = "disputed";
	}
	return event;
}
