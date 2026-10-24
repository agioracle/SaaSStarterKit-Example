import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
	createCreemProvider,
	createPaymentService,
	createStripeProvider,
	createWaffoProvider,
	foldPaymentEvents,
	hasPaymentAccess,
	normalizeCreemEvent,
	normalizeStripeEvent,
	normalizeWaffoEvent,
	paymentWebhookResponse,
	sameOriginReturnUrl,
	type CheckoutLookup,
	type CheckoutRecord,
	type PaymentEvent,
	type PaymentPlan,
	type PaymentAdapter,
	type PaymentProviderId,
	type PaymentStore,
} from "../src/payment";
const now = 1_800_000_000_000;
const user = { id: "user-1", email: "user@example.com" };
const otherUser = { id: "user-2", email: "other@example.com" };
const plan: PaymentPlan = {
	id: "pro-monthly",
	priceId: "price_pro",
	kind: "subscription",
	amount: 990,
	currency: "USD",
	interval: "month",
};
const lifetime: PaymentPlan = {
	id: "lifetime",
	priceId: "price_lifetime",
	kind: "one_time",
	amount: 19900,
	currency: "USD",
};
const checkout: CheckoutRecord = {
	reference: "reference-1",
	userId: user.id,
	provider: "stripe",
	plan,
	createdAt: now - 10000,
	sessionId: "cs_current",
};
function fact(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
	return {
		provider: "stripe",
		id: "evt_1",
		type: "invoice.paid",
		occurredAt: now,
		effect: "grant",
		state: "active",
		periodEnd: now + 86400000,
		checkoutReference: checkout.reference,
		lookup: {
			checkoutReference: checkout.reference,
			subscriptionId: "sub_1",
			customerId: "cus_1",
		},
		...overrides,
	};
}
/** Reference test store only; production must use durable SQL's unique key. */
class MemoryStore implements PaymentStore {
	checkouts: CheckoutRecord[] = [];
	events: PaymentEvent[] = [];
	async createCheckout(value: CheckoutRecord) {
		this.checkouts.push({ ...value });
	}
	async attachCheckout(
		provider: PaymentProviderId,
		reference: string,
		sessionId: string,
	) {
		const value = this.checkouts.find(
			(item) => item.provider === provider && item.reference === reference,
		);
		if (value) value.sessionId = sessionId;
	}
	async findCheckout(provider: PaymentProviderId, lookup: CheckoutLookup) {
		return (
			this.checkouts.find(
				(item) =>
					item.provider === provider &&
					(item.reference === lookup.checkoutReference ||
						(lookup.sessionId !== undefined &&
							item.sessionId === lookup.sessionId) ||
						this.events.some(
							(event) =>
								event.provider === provider &&
								event.checkoutReference === item.reference &&
								Object.entries(lookup).some(
									([key, value]) =>
										value !== undefined &&
										key !== "customerId" &&
										event.lookup[key as keyof CheckoutLookup] === value,
								),
						)),
			) ?? null
		);
	}
	async listCheckouts(userId: string) {
		return this.checkouts.filter((item) => item.userId === userId);
	}
	async listEvents(provider: PaymentProviderId, reference: string) {
		return this.events.filter(
			(event) =>
				event.provider === provider && event.checkoutReference === reference,
		);
	}
	async appendEvent(
		event: PaymentEvent & { checkoutReference: string },
	): Promise<"inserted" | "duplicate"> {
		if (
			this.events.some(
				(previous) =>
					previous.id === event.id && previous.provider === event.provider,
			)
		)
			return "duplicate";
		this.events.push(event);
		return "inserted";
	}
}
function providerMock(event = fact()): PaymentAdapter {
	return {
		id: "stripe",
		createCheckout: vi.fn(async () => ({
			sessionId: "cs_new",
			url: "https://checkout.stripe.com/test",
		})),
		createPortal: vi.fn(async () => "https://billing.stripe.com/test"),
		cancelSubscription: vi.fn(async () => {}),
		verifyWebhook: vi.fn(async () => event),
	};
}
function setup(event = fact()) {
	const store = new MemoryStore();
	store.checkouts.push({ ...checkout });
	const provider = providerMock(event);
	const service = createPaymentService({
		provider,
		plans: [plan, lifetime],
		appOrigin: "https://app.example.com",
		store,
		now: () => now,
		newReference: () => "new-reference",
	});
	return { store, provider, service };
}
describe("payment entitlement ledger", () => {
	it("never grants from context events or subscription active sync", () => {
		expect(
			hasPaymentAccess(
				foldPaymentEvents(checkout, [fact({ effect: "sync" })]),
				now,
			),
		).toBe(false);
		expect(
			hasPaymentAccess(
				foldPaymentEvents(checkout, [fact({ effect: "receipt" })]),
				now,
			),
		).toBe(false);
	});
	it("requires a paid and unexpired subscription period", () => {
		expect(hasPaymentAccess(foldPaymentEvents(checkout, [fact()]), now)).toBe(
			true,
		);
		expect(
			hasPaymentAccess(
				foldPaymentEvents(checkout, [fact({ periodEnd: now - 1 })]),
				now,
			),
		).toBe(false);
		expect(
			hasPaymentAccess(
				foldPaymentEvents(checkout, [fact({ periodEnd: undefined })]),
				now,
			),
		).toBe(false);
	});
	it("does not extend paid access from subscription synchronization alone", () => {
		const result = foldPaymentEvents(checkout, [
			fact({ periodEnd: now + 1 }),
			fact({
				id: "sync",
				occurredAt: now + 2,
				effect: "sync",
				periodEnd: now + 500000,
			}),
		]);
		expect(result.periodEnd).toBe(now + 1);
	});
	it("orders events by provider time, not delivery time", () => {
		const result = foldPaymentEvents(checkout, [
			fact({
				id: "cancel",
				occurredAt: now + 5,
				effect: "revoke",
				state: "canceled",
			}),
			fact(),
		]);
		expect(result.state).toBe("canceled");
	});
	it("keeps cancel-at-period-end active until the paid deadline", () => {
		const result = foldPaymentEvents(checkout, [
			fact(),
			fact({
				id: "canceling",
				occurredAt: now + 1,
				effect: "sync",
				cancelAtPeriodEnd: true,
			}),
		]);
		expect(result.cancelAtPeriodEnd).toBe(true);
		expect(hasPaymentAccess(result, now + 2)).toBe(true);
		expect(hasPaymentAccess(result, now + 86400001)).toBe(false);
	});
	it("supports trial access without misrepresenting a paid order", () => {
		const result = foldPaymentEvents(checkout, [
			fact({ effect: "sync", state: "trialing" }),
		]);
		expect(result.paid).toBe(false);
		expect(hasPaymentAccess(result, now)).toBe(true);
	});
	it("keeps full refund revocation sticky against delayed or newer paid events", () => {
		const result = foldPaymentEvents({ ...checkout, plan: lifetime }, [
			fact(),
			fact({
				id: "refund",
				occurredAt: now + 1,
				effect: "revoke",
				state: "refunded",
			}),
			fact({ id: "late", occurredAt: now + 2 }),
		]);
		expect(result.state).toBe("refunded");
		expect(hasPaymentAccess(result, now)).toBe(false);
	});
	it("one-time access has no artificial expiration", () =>
		expect(
			hasPaymentAccess(
				foldPaymentEvents({ ...checkout, plan: lifetime }, [
					fact({ periodEnd: undefined }),
				]),
				now + 1e12,
			),
		).toBe(true));
});
describe("authenticated service boundaries", () => {
	it("does not confuse a previous paid purchase with the current checkout", async () => {
		const { service, store } = setup();
		store.events.push(fact());
		store.checkouts.push({
			...checkout,
			reference: "pending-ref",
			sessionId: "cs_pending",
		});
		expect(
			(await service.getCheckoutStatus(user, "cs_current")).hasAccess,
		).toBe(true);
		expect((await service.getCheckoutStatus(user, "cs_pending")).paid).toBe(
			false,
		);
	});
	it("denies other users and unauthenticated status/portal/cancellation", async () => {
		const { service, provider } = setup();
		await expect(
			service.getCheckoutStatus(otherUser, checkout.reference),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(service.createPortal(null)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		await expect(
			service.cancelSubscription(otherUser, checkout.reference),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(provider.cancelSubscription).not.toHaveBeenCalled();
	});
	it("resolves customer and subscription ids from the owning user ledger", async () => {
		const { service, store, provider } = setup();
		store.events.push(fact());
		await service.createPortal(user, "/billing");
		expect(provider.createPortal).toHaveBeenCalledWith({
			user,
			customerId: "cus_1",
			returnUrl: "https://app.example.com/billing",
		});
		await service.cancelSubscription(user, checkout.reference);
		expect(provider.cancelSubscription).toHaveBeenCalledWith({
			subscriptionId: "sub_1",
			atPeriodEnd: true,
		});
	});
	it("rejects client-provided prices and off-origin return URLs before checkout calls", async () => {
		const { service, provider } = setup();
		await expect(
			service.createCheckout(user, { priceId: "arbitrary" }),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await expect(
			service.createCheckout(user, {
				priceId: plan.priceId,
				successUrl: "https://evil.test/",
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		expect(provider.createCheckout).not.toHaveBeenCalled();
	});
	it("persists pending context before calling the checkout provider", async () => {
		const { service, store, provider } = setup();
		vi.mocked(provider.createCheckout).mockImplementation(async (input) => {
			expect(
				store.checkouts.find((item) => item.reference === input.reference),
			).toBeDefined();
			return { sessionId: "cs_new", url: "https://checkout.stripe.com/test" };
		});
		await service.createCheckout(user, { priceId: plan.priceId });
		expect(store.checkouts.at(-1)?.sessionId).toBe("cs_new");
	});
	it("atomically deduplicates parallel delivery through a single ledger append", async () => {
		const { service, store } = setup();
		const results = await Promise.all(
			Array.from({ length: 10 }, () =>
				service.handleWebhook("{}", new Headers()),
			),
		);
		expect(
			results.filter((result) => result.status === "inserted"),
		).toHaveLength(1);
		expect(store.events).toHaveLength(1);
	});
	it("requires retry if checkout correlation or subscription paid period is missing", async () => {
		const missing = setup(fact({ lookup: { subscriptionId: "unknown" } }));
		await expect(
			missing.service.handleWebhook("{}", new Headers()),
		).rejects.toMatchObject({ code: "RETRY" });
		const noPeriod = setup(fact({ periodEnd: undefined }));
		await expect(
			noPeriod.service.handleWebhook("{}", new Headers()),
		).rejects.toMatchObject({ code: "RETRY" });
	});
	it("does not consume an event on a failed durable append", async () => {
		const { service, store } = setup();
		const append = vi
			.spyOn(store, "appendEvent")
			.mockRejectedValueOnce(new Error("Database temporarily unavailable"));
		await expect(service.handleWebhook("{}", new Headers())).rejects.toThrow();
		expect(store.events).toHaveLength(0);
		await expect(service.handleWebhook("{}", new Headers())).resolves.toEqual({
			status: "inserted",
		});
		expect(append).toHaveBeenCalledTimes(2);
	});
});
describe("strict return URLs", () => {
	it("accepts same-origin absolute and root relative URLs", () => {
		expect(
			sameOriginReturnUrl("/settings?tab=billing", "https://app.test"),
		).toBe("https://app.test/settings?tab=billing");
		expect(sameOriginReturnUrl("https://app.test/ok", "https://app.test")).toBe(
			"https://app.test/ok",
		);
	});
	it.each([
		"//evil.test",
		"https://app.test.evil.test",
		"https://sub.app.test/",
		"http://app.test/",
		"javascript:alert(1)",
		"/\\evil.test",
		" https://app.test/",
		"https://user:password@app.test/",
	])("rejects %s", (value) =>
		expect(() => sameOriginReturnUrl(value, "https://app.test")).toThrow(),
	);
});
const stripePayload = (type: string, data: Record<string, unknown>) => ({
	id: `evt_${type}`,
	type,
	created: now / 1000,
	livemode: false,
	data: { object: data },
});
describe("Stripe verified adapter", () => {
	const config = {
		secretKey: "sk_test_fake",
		webhookSecret: "whsec_fake",
		mode: "test" as const,
		now: () => now,
	};
	it("fails missing configuration rather than reporting payment success", () =>
		expect(() => createStripeProvider({ mode: "test" })).toThrow(
			"STRIPE_SECRET_KEY",
		));
	it("verifies raw HMAC signatures and rejects tampering/stale timestamps/wrong mode", async () => {
		const provider = createStripeProvider(config);
		const body = JSON.stringify(
			stripePayload("invoice.paid", {
				id: "in_1",
				paid: true,
				metadata: { checkoutReference: checkout.reference },
				lines: {
					data: [
						{
							period: { end: (now + 86400000) / 1000 },
							price: { id: plan.priceId },
						},
					],
				},
			}),
		);
		const sig = createHmac("sha256", config.webhookSecret)
			.update(`${now / 1000}.${body}`)
			.digest("hex");
		const headers = new Headers({
			"stripe-signature": `t=${now / 1000},v1=${sig}`,
		});
		expect((await provider.verifyWebhook(body, headers)).effect).toBe("grant");
		await expect(
			provider.verifyWebhook(`${body} `, headers),
		).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
		await expect(
			createStripeProvider({
				...config,
				now: () => now + 300001,
			}).verifyWebhook(body, headers),
		).rejects.toThrow("stale");
		await expect(
			createStripeProvider({ ...config, mode: "live" }).verifyWebhook(
				body,
				headers,
			),
		).rejects.toThrow("environment");
	});
	it("invoice-first and zero-cost lifetime use invoice metadata without requiring a PaymentIntent", () => {
		const result = normalizeStripeEvent(
			stripePayload("invoice.paid", {
				id: "in_free",
				paid: true,
				amount_paid: 0,
				metadata: { checkoutReference: checkout.reference },
			}),
		);
		expect(result.lookup.checkoutReference).toBe(checkout.reference);
		expect(result.effect).toBe("grant");
		expect(result.lookup.paymentIntentId).toBeUndefined();
	});
	it("only full refunds revoke and checkout completion is context-only", () => {
		expect(
			normalizeStripeEvent(
				stripePayload("checkout.session.completed", {
					id: "cs_1",
					payment_status: "paid",
				}),
			).effect,
		).toBe("sync");
		expect(
			normalizeStripeEvent(
				stripePayload("charge.refunded", {
					amount: 100,
					amount_refunded: 50,
					payment_intent: "pi_1",
				}),
			).effect,
		).toBe("ignore");
		expect(
			normalizeStripeEvent(
				stripePayload("charge.refunded", {
					amount: 100,
					amount_refunded: 100,
					payment_intent: "pi_1",
				}),
			).effect,
		).toBe("revoke");
	});
	it("sends server metadata, idempotency key and enables one-time invoices", async () => {
		const transport = vi.fn<typeof fetch>(async () =>
			Response.json({ id: "cs_new", url: "https://checkout.stripe.com/test" }),
		);
		const provider = createStripeProvider({ ...config, fetch: transport });
		await provider.createCheckout({
			user,
			plan: lifetime,
			reference: "new-ref",
			successUrl: "https://app.test/payment",
			cancelUrl: "https://app.test/pricing",
		});
		const request = transport.mock.calls[0]?.[1];
		const params = request?.body as URLSearchParams;
		expect(params.get("invoice_creation[enabled]")).toBe("true");
		expect(
			params.get("invoice_creation[invoice_data][metadata][checkoutReference]"),
		).toBe("new-ref");
		expect(new Headers(request?.headers).get("idempotency-key")).toBe(
			"new-ref",
		);
	});
});
describe("Creem verified adapter", () => {
	const payload = (type: string, data: Record<string, unknown>) => ({
		id: `evt_${type}`,
		eventType: type,
		created_at: now,
		object: data,
	});
	it("verifies Creem raw signature and rejects a changed body", async () => {
		const provider = createCreemProvider({
			apiKey: "test",
			webhookSecret: "secret",
			mode: "test",
		});
		const body = JSON.stringify(
			payload("subscription.paid", {
				id: "sub_1",
				mode: "test",
				current_period_end_date: new Date(now + 86400000).toISOString(),
			}),
		);
		const headers = new Headers({
			"creem-signature": createHmac("sha256", "secret")
				.update(body)
				.digest("hex"),
		});
		expect((await provider.verifyWebhook(body, headers)).effect).toBe("grant");
		await expect(
			provider.verifyWebhook(`${body} `, headers),
		).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
	});
	it("uses paid authority and recoverable expired state", () => {
		expect(
			normalizeCreemEvent(
				payload("subscription.active", { id: "sub_1", status: "active" }),
			).effect,
		).toBe("sync");
		expect(
			normalizeCreemEvent(payload("subscription.expired", { id: "sub_1" }))
				.state,
		).toBe("past_due");
		expect(
			normalizeCreemEvent(payload("subscription.canceled", { id: "sub_1" }))
				.effect,
		).toBe("revoke");
	});
	it("documents refund/dispute parity and explicit safety extension", () => {
		expect(
			normalizeCreemEvent(payload("refund.created", { order: "ord_1" })).effect,
		).toBe("ignore");
		expect(
			normalizeCreemEvent(payload("dispute.created", { order: "ord_1" }), true)
				.state,
		).toBe("disputed");
	});
	it("grants completed paid one-time purchases but not recurring checkout events", () => {
		expect(
			normalizeCreemEvent(
				payload("checkout.completed", {
					product: { billing_type: "onetime" },
					order: { status: "paid" },
				}),
			).effect,
		).toBe("grant");
		expect(
			normalizeCreemEvent(
				payload("checkout.completed", {
					subscription: "sub_1",
					order: { status: "paid" },
				}),
			).effect,
		).toBe("sync");
	});
	it("uses the test API with correct customer portal and cancellation contracts", async () => {
		const transport = vi.fn<typeof fetch>(async (input) =>
			Response.json(
				String(input).endsWith("/billing")
					? { customer_portal_link: "https://creem.io/portal" }
					: {},
			),
		);
		const provider = createCreemProvider({
			apiKey: "fake",
			webhookSecret: "fake",
			mode: "test",
			fetch: transport,
		});
		await provider.createPortal({
			user,
			customerId: "cust_1",
			returnUrl: "https://app.test/billing",
		});
		await provider.cancelSubscription({
			subscriptionId: "sub_1",
			atPeriodEnd: true,
		});
		expect(transport.mock.calls[0]?.[0]).toBe(
			"https://test-api.creem.io/v1/customers/billing",
		);
		expect(JSON.parse(transport.mock.calls[1]?.[1]?.body as string)).toEqual({
			mode: "scheduled",
			onExecute: "cancel",
		});
	});
});
describe("Waffo verified adapter", () => {
	const keys = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		publicKeyEncoding: { type: "spki", format: "pem" },
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
	});
	const payload = (type: string, data: Record<string, unknown> = {}) => ({
		id: "ORD_1",
		eventId: "ORD_1",
		eventType: type,
		timestamp: new Date(now).toISOString(),
		storeId: "STO_0123456789012345678901",
		mode: "test",
		data: {
			orderId: "ORD_1",
			orderMerchantExternalId: checkout.reference,
			...data,
		},
	});
	const config = {
		merchantId: "MER_0123456789012345678901",
		privateKey: keys.privateKey,
		storeId: "STO_0123456789012345678901",
		mode: "test" as const,
		webhookPublicKeys: { test: keys.publicKey, prod: keys.publicKey },
	};
	function sign(body: string, time = Date.now()) {
		const signature = createSign("RSA-SHA256")
			.update(`${time}.${body}`)
			.sign(keys.privateKey, "base64");
		return new Headers({ "x-waffo-signature": `t=${time},v1=${signature}` });
	}
	it("uses the official RSA verifier, mode boundary and retry-compatible timestamp window", async () => {
		const provider = createWaffoProvider(config);
		const body = JSON.stringify(payload("order.completed"));
		expect(
			(await provider.verifyWebhook(body, sign(body, Date.now() - 31 * 60000)))
				.effect,
		).toBe("grant");
		await expect(
			provider.verifyWebhook(body, sign(body, Date.now() - 46 * 60000)),
		).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
		await expect(
			provider.verifyWebhook(`${body} `, sign(body)),
		).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
		await expect(
			createWaffoProvider({ ...config, mode: "live" }).verifyWebhook(
				body,
				sign(body),
			),
		).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
	});
	it("correlates generated reference, not CHK id, and separates shared provider event ids", () => {
		const activated = normalizeWaffoEvent(
			payload("subscription.activated", { currentPeriodEnd: "2030-01-01" }),
		);
		const canceled = normalizeWaffoEvent(payload("subscription.canceled"));
		expect(activated.lookup.checkoutReference).toBe(checkout.reference);
		expect(activated.id).not.toBe(canceled.id);
	});
	it("records payments without mutating lifecycle and revokes even partial refunds", () => {
		expect(
			normalizeWaffoEvent(payload("subscription.payment_succeeded")).effect,
		).toBe("receipt");
		expect(
			normalizeWaffoEvent(
				payload("refund.succeeded", {
					refundedAmount: "1.00",
					originalChargedAmount: "99.00",
				}),
			).state,
		).toBe("refunded");
		expect(normalizeWaffoEvent(payload("refund.failed")).effect).toBe("ignore");
		expect(
			normalizeWaffoEvent(
				payload("subscription.plan_change_failed", { orderStatus: "canceled" }),
			).effect,
		).toBe("ignore");
	});
	it("uses new product metadata, not stale order metadata, for plan changes", () => {
		const result = normalizeWaffoEvent(
			payload("subscription.plan_changed", {
				productMetadata: { priceId: "PROD_new" },
				orderMetadata: { priceId: "PROD_old" },
				currentPeriodStart: "2029-12-01",
				currentPeriodEnd: "2030-01-01",
			}),
		);
		expect(result.priceId).toBe("PROD_new");
	});
	it("creates signed authenticated checkout with mocked transport and server identity", async () => {
		const transport = vi.fn<typeof fetch>(async (input) =>
			Response.json({
				data: String(input).endsWith("/issue-session-token")
					? { token: "fixture-token", expiresAt: "2030-01-01T00:00:00.000Z" }
					: {
							sessionId: "CHK_0123456789012345678901",
							checkoutUrl: "https://pancake.waffo.ai/checkout/fixture",
							expiresAt: "2030-01-01T00:00:00.000Z",
						},
			}),
		);
		const provider = createWaffoProvider({ ...config, fetch: transport });
		const result = await provider.createCheckout({
			user,
			plan: { ...plan, priceId: "PROD_0123456789012345678901" },
			reference: "server-reference",
			successUrl: "https://app.test/settings/payment",
			cancelUrl: "https://app.test/pricing",
		});
		expect(result.sessionId).toBe("CHK_0123456789012345678901");
		expect(result.url).toContain("#token=fixture-token");
		const tokenCall = transport.mock.calls.find((call) =>
			String(call[0]).endsWith("/issue-session-token"),
		);
		const sessionCall = transport.mock.calls.find((call) =>
			String(call[0]).endsWith("/create-session"),
		);
		expect(JSON.parse(tokenCall?.[1]?.body as string).buyerIdentity).toBe(
			user.id,
		);
		const sent = JSON.parse(sessionCall?.[1]?.body as string);
		expect(sent.orderMerchantExternalId).toBe("server-reference");
		expect(sent.successUrl).toContain("checkout_id=server-reference");
		expect(
			new Headers(sessionCall?.[1]?.headers).get("x-idempotency-key"),
		).toBe("server-reference");
		expect(
			new Headers(sessionCall?.[1]?.headers).get("x-signature"),
		).toBeTruthy();
		expect(sessionCall?.[1]?.redirect).toBe("error");
	});
	it("does not report cancellation success on non-2xx SDK envelopes", async () => {
		const transport = vi.fn<typeof fetch>(async () =>
			Response.json({}, { status: 503 }),
		);
		const provider = createWaffoProvider({ ...config, fetch: transport });
		await expect(
			provider.cancelSubscription({
				subscriptionId: "ORD_0123456789012345678901",
				atPeriodEnd: true,
			}),
		).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
	});
	it("does not invent immediate cancellation support", async () => {
		await expect(
			createWaffoProvider(config).cancelSubscription({
				subscriptionId: "ORD_1",
				atPeriodEnd: false,
			}),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
	});
});
describe("webhook HTTP semantics", () => {
	it("does not acknowledge unconfigured or wrong-provider webhooks", async () => {
		const request = new Request("https://app.test/api/webhooks/stripe", {
			method: "POST",
		});
		expect(
			(
				await paymentWebhookResponse(request, {
					enabled: false,
					routeProvider: "stripe",
				})
			).status,
		).toBe(404);
		expect(
			(
				await paymentWebhookResponse(request, {
					enabled: true,
					configuredProvider: "creem",
					routeProvider: "stripe",
				})
			).status,
		).toBe(404);
	});
	it("returns 500 for transient durable-storage failures and 200 only after persistence", async () => {
		const { service, store } = setup();
		vi.spyOn(store, "appendEvent").mockRejectedValueOnce(
			new Error("D1 unavailable"),
		);
		const options = {
			enabled: true,
			configuredProvider: "stripe",
			routeProvider: "stripe",
			service,
		};
		expect(
			(
				await paymentWebhookResponse(
					new Request("https://app.test/webhook", {
						method: "POST",
						body: "{}",
					}),
					options,
				)
			).status,
		).toBe(500);
		expect(
			(
				await paymentWebhookResponse(
					new Request("https://app.test/webhook", {
						method: "POST",
						body: "{}",
					}),
					options,
				)
			).status,
		).toBe(200);
	});
});

describe("additional payment regression boundaries", () => {
	it("does not recover suspended access using a mere active synchronization", () => {
		const result = foldPaymentEvents(checkout, [
			fact(),
			fact({
				id: "unpaid",
				occurredAt: now + 1,
				effect: "sync",
				state: "unpaid",
			}),
			fact({
				id: "active-sync",
				occurredAt: now + 2,
				effect: "sync",
				state: "active",
			}),
		]);
		expect(result.state).toBe("unpaid");
		expect(hasPaymentAccess(result, now)).toBe(false);
	});
	it("retries a Waffo order.completed miscorrelated to a subscription without granting", async () => {
		const { service, provider, store } = setup(
			fact({
				provider: "waffo",
				type: "order.completed",
				periodEnd: undefined,
			}),
		);
		provider.id = "waffo";
		store.checkouts[0] = { ...checkout, provider: "waffo" };
		await expect(
			service.handleWebhook("{}", new Headers()),
		).rejects.toMatchObject({ code: "RETRY" });
		expect(store.events).toHaveLength(0);
	});
	it("notifies once only after committing and does not roll back on notification failure", async () => {
		const store = new MemoryStore();
		store.checkouts.push(checkout);
		const onPaymentRecorded = vi.fn(async () => {
			throw new Error("Notification endpoint unavailable");
		});
		const service = createPaymentService({
			provider: providerMock(),
			plans: [plan],
			appOrigin: "https://app.test",
			store,
			onPaymentRecorded,
		});
		await expect(service.handleWebhook("{}", new Headers())).resolves.toEqual({
			status: "inserted",
		});
		await expect(service.handleWebhook("{}", new Headers())).resolves.toEqual({
			status: "duplicate",
		});
		expect(store.events).toHaveLength(1);
		expect(onPaymentRecorded).toHaveBeenCalledTimes(1);
	});
	it("rejects oversized chunked webhook streams before provider verification", async () => {
		const { service, provider } = setup();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(600000));
				controller.enqueue(new Uint8Array(600000));
				controller.close();
			},
		});
		const request = new Request("https://app.test/webhook", {
			method: "POST",
			body,
			duplex: "half",
		} as RequestInit);
		expect(
			(
				await paymentWebhookResponse(request, {
					enabled: true,
					configuredProvider: "stripe",
					routeProvider: "stripe",
					service,
				})
			).status,
		).toBe(413);
		expect(provider.verifyWebhook).not.toHaveBeenCalled();
	});
	it("matches Stripe full lifetime refund to that purchase, not other lifetime purchases", async () => {
		const event = fact({
			id: "evt_refund",
			type: "charge.refunded",
			effect: "revoke",
			state: "refunded",
			lookup: { paymentIntentId: "pi_refunded" },
		});
		const { service, store } = setup(event);
		store.checkouts[0] = { ...checkout, plan: lifetime };
		store.checkouts.push({
			...checkout,
			reference: "other-lifetime",
			sessionId: "cs_other",
			plan: lifetime,
		});
		store.events.push(
			fact({ lookup: { paymentIntentId: "pi_refunded" } }),
			fact({
				id: "other_paid",
				checkoutReference: "other-lifetime",
				lookup: { paymentIntentId: "pi_other" },
			}),
		);
		await service.handleWebhook("{}", new Headers());
		expect(
			(await service.getCheckoutStatus(user, checkout.reference)).hasAccess,
		).toBe(false);
		expect(
			(await service.getCheckoutStatus(user, "other-lifetime")).hasAccess,
		).toBe(true);
	});
	it("rejects wrong-mode Creem fixtures even with valid signatures", async () => {
		const provider = createCreemProvider({
			apiKey: "fake",
			webhookSecret: "secret",
			mode: "live",
		});
		const body = JSON.stringify({
			id: "evt_1",
			eventType: "checkout.completed",
			created_at: now,
			object: { mode: "test" },
		});
		await expect(
			provider.verifyWebhook(
				body,
				new Headers({
					"creem-signature": createHmac("sha256", "secret")
						.update(body)
						.digest("hex"),
				}),
			),
		).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
	});
});
