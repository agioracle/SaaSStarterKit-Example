import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
	createCreemProvider,
	normalizeCreemEvent,
} from "../src/payment/providers/creem";
import {
	createStripeProvider,
	normalizeStripeEvent,
} from "../src/payment/providers/stripe";
import type { ProviderCheckoutInput } from "../src/payment/types";

const now = 1_790_000_000_123;
const second = Math.floor(now / 1000);
const input: ProviderCheckoutInput = {
	user: { id: "user_review", email: "fixture@example.test" },
	plan: {
		id: "pro",
		priceId: "price_pro",
		kind: "subscription",
		amount: 2000,
		currency: "usd",
	},
	reference: "checkout_review",
	customerId: "cus_existing",
	successUrl: "https://app.test/settings/payment",
	cancelUrl: "https://app.test/pricing",
};
const stripeConfig = {
	secretKey: "sk_test_fixture",
	webhookSecret: "whsec_fixture",
	mode: "test" as const,
	now: () => now,
};
const creemConfig = {
	apiKey: "creem_test_fixture",
	webhookSecret: "creem_whsec_fixture",
	mode: "test" as const,
	now: () => now,
};
const stripeEvent = (type: string, data: Record<string, unknown>) => ({
	id: "evt_review",
	type,
	created: second,
	livemode: false,
	data: { object: data },
});
const creemEvent = (type: string, data: Record<string, unknown>) => ({
	id: "evt_review",
	eventType: type,
	created_at: now,
	object: data,
});
const line = (
	price = "price_pro",
	amount = 2000,
	extra: Record<string, unknown> = {},
) => ({
	amount,
	type: "subscription",
	subscription: "sub_review",
	subscription_item: "si_review",
	price: { id: price },
	proration: false,
	period: { start: second, end: second + 86400 },
	...extra,
});
const invoice = (
	lines: Record<string, unknown>[],
	extra: Record<string, unknown> = {},
) => ({
	id: "in_review",
	paid: true,
	subscription: "sub_review",
	lines: { data: lines, has_more: false },
	...extra,
});
const stripeSession = (extra: Record<string, unknown> = {}) => ({
	id: "cs_review",
	status: "open",
	livemode: false,
	mode: "subscription",
	client_reference_id: input.reference,
	metadata: { checkoutReference: input.reference },
	customer: "cus_existing",
	subscription: "sub_review",
	url: "https://checkout.stripe.com/test",
	...extra,
});
const creemSession = (extra: Record<string, unknown> = {}) => ({
	id: "ch_review",
	status: "pending",
	mode: "test",
	request_id: input.reference,
	metadata: { checkoutReference: input.reference },
	customer: "cust_existing",
	subscription: "sub_review",
	checkout_url: "https://checkout.creem.io/test",
	...extra,
});

describe("Stripe invoice line authority", () => {
	it("ignores a credit-first old price and its longer period", () => {
		const result = normalizeStripeEvent(
			stripeEvent(
				"invoice.paid",
				invoice([
					line("price_old", -1000, {
						proration: true,
						period: { start: second - 86400, end: second + 365 * 86400 },
					}),
					line("price_pro", 2000, { proration: true }),
				]),
			),
		);
		expect(result).toMatchObject({
			effect: "grant",
			priceId: "price_pro",
			periodStart: second * 1000,
			periodEnd: (second + 86400) * 1000,
			lookup: { subscriptionId: "sub_review", subscriptionItemId: "si_review" },
		});
	});
	it("supports modern nested proration fields and prefers a non-proration line", () => {
		const modern = (price: string, amount: number, proration: boolean) => ({
			amount,
			parent: {
				type: "subscription_item_details",
				subscription_item_details: {
					subscription: "sub_review",
					subscription_item: "si_review",
					proration,
				},
			},
			pricing: { price_details: { price } },
			period: { start: second, end: second + 86400 },
		});
		const result = normalizeStripeEvent(
			stripeEvent(
				"invoice.paid",
				invoice([
					modern("price_credit", -1000, true),
					modern("price_previous", 200, true),
					modern("price_pro", 2000, false),
				]),
			),
		);
		expect(result.priceId).toBe("price_pro");
		expect(result.lookup.subscriptionItemId).toBe("si_review");
	});
	it("allows a fully discounted paid invoice and zero recurring line", () => {
		const result = normalizeStripeEvent(
			stripeEvent(
				"invoice.paid",
				invoice([line("price_pro", 0)], { amount_paid: 0, total: 0 }),
			),
		);
		expect(result).toMatchObject({
			effect: "grant",
			priceId: "price_pro",
			periodEnd: (second + 86400) * 1000,
		});
	});
	it.each([
		[
			"multiple items",
			invoice([
				line(),
				line("price_extra", 500, { subscription_item: "si_extra" }),
			]),
		],
		["multiple prices", invoice([line(), line("price_extra", 500)])],
		[
			"credit-only invoice",
			invoice([line("price_old", -1000, { proration: true })]),
		],
		["missing amount", invoice([line("price_pro", 1, { amount: undefined })])],
		["missing period", invoice([line("price_pro", 1, { period: {} })])],
		[
			"truncated lines",
			invoice([], { lines: { data: [line()], has_more: true } }),
		],
		[
			"other subscription",
			invoice([line("price_pro", 1, { subscription: "sub_other" })]),
		],
	])("fails retryably rather than guessing: %s", (_label, data) => {
		expect(() =>
			normalizeStripeEvent(stripeEvent("invoice.paid", data)),
		).toThrow(expect.objectContaining({ code: "RETRY" }));
	});
	it("normalizes failed-invoice coverage but never borrows dates from ambiguous lines", () => {
		const known = normalizeStripeEvent(
			stripeEvent("invoice.payment_failed", invoice([line()], { paid: false })),
		);
		expect(known).toMatchObject({
			state: "past_due",
			periodStart: second * 1000,
			periodEnd: (second + 86400) * 1000,
		});
		const ambiguous = normalizeStripeEvent(
			stripeEvent(
				"invoice.payment_failed",
				invoice([line(), line("price_other")], { paid: false }),
			),
		);
		expect(ambiguous.state).toBe("past_due");
		expect(ambiguous.periodEnd).toBeUndefined();
	});
	it("rejects multiple/truncated subscription items rather than choosing items[0]", () => {
		for (const items of [
			{
				data: [
					{ id: "si_a", price: "price_pro" },
					{ id: "si_b", price: "price_other" },
				],
			},
			{ data: [{ id: "si_a", price: "price_pro" }], has_more: true },
		]) {
			expect(() =>
				normalizeStripeEvent(
					stripeEvent("customer.subscription.updated", {
						id: "sub_review",
						status: "active",
						items,
					}),
				),
			).toThrow(expect.objectContaining({ code: "RETRY" }));
		}
	});
});

describe("Stripe customer identity and safe checkout reconciliation", () => {
	it("creates a stable per-user customer and reuses it without customer_email/customer_creation", async () => {
		const transport = vi.fn<typeof fetch>(async (url) =>
			Response.json(
				String(url).endsWith("/customers")
					? { id: "cus_existing" }
					: stripeSession(),
			),
		);
		const provider = createStripeProvider({
			...stripeConfig,
			fetch: transport,
		});
		await expect(provider.ensureCustomer?.(input.user)).resolves.toBe(
			"cus_existing",
		);
		const createCustomer = transport.mock.calls[0]?.[1];
		expect(new Headers(createCustomer?.headers).get("idempotency-key")).toBe(
			"edgekit-customer:user_review",
		);
		expect(
			(createCustomer?.body as URLSearchParams | undefined)?.get(
				"metadata[userId]",
			),
		).toBe(input.user.id);
		await provider.createCheckout(input);
		await provider.createCheckout({
			...input,
			plan: { ...input.plan, kind: "one_time" },
		});
		for (const [, request] of transport.mock.calls.slice(1)) {
			const params = request?.body as URLSearchParams;
			expect(params.get("customer")).toBe("cus_existing");
			expect(params.has("customer_email")).toBe(false);
			expect(params.has("customer_creation")).toBe(false);
		}
	});
	it.each([
		["open", "open"],
		["complete", "completed"],
		["expired", "expired"],
		["future_state", "unknown"],
	])(
		"retrieves known session status %s as %s, without POST",
		async (status, lifecycle) => {
			const transport = vi.fn<typeof fetch>(async () =>
				Response.json(
					stripeSession({
						status,
						url: status === "open" ? "https://checkout.stripe.com/test" : null,
					}),
				),
			);
			const provider = createStripeProvider({
				...stripeConfig,
				fetch: transport,
			});
			await expect(
				provider.reconcileCheckout?.({
					reference: input.reference,
					sessionId: "cs_review",
				}),
			).resolves.toMatchObject({ lifecycle, sessionId: "cs_review" });
			expect(transport).toHaveBeenCalledTimes(1);
			expect(transport.mock.calls[0]?.[1]).toMatchObject({
				method: "GET",
				body: undefined,
			});
		},
	);
	it("replays exactly the saved creation request/key then retrieves even a completed response without URL", async () => {
		const transport = vi.fn<typeof fetch>(async (_url, request) =>
			Response.json(
				stripeSession(
					request?.method === "POST"
						? { status: "complete", url: null }
						: { status: "expired", url: null },
				),
			),
		);
		const provider = createStripeProvider({
			...stripeConfig,
			fetch: transport,
		});
		await expect(
			provider.reconcileCheckout?.({
				reference: input.reference,
				recovery: input,
			}),
		).resolves.toMatchObject({ lifecycle: "expired" });
		expect(transport.mock.calls.map(([, request]) => request?.method)).toEqual([
			"POST",
			"GET",
		]);
		const request = transport.mock.calls[0]?.[1];
		expect(new Headers(request?.headers).get("idempotency-key")).toBe(
			input.reference,
		);
		expect(
			(request?.body as URLSearchParams | undefined)?.get(
				"line_items[0][price]",
			),
		).toBe(input.plan.priceId);
		expect(
			(request?.body as URLSearchParams | undefined)?.get("customer"),
		).toBe(input.customerId);
	});
	it("does not create without immutable recovery and rejects reference mismatch before I/O", async () => {
		const transport = vi.fn<typeof fetch>();
		const provider = createStripeProvider({
			...stripeConfig,
			fetch: transport,
		});
		await expect(
			provider.reconcileCheckout?.({ reference: input.reference }),
		).resolves.toEqual({ lifecycle: "unknown" });
		await expect(
			provider.reconcileCheckout?.({ reference: "other", recovery: input }),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		expect(transport).not.toHaveBeenCalled();
	});
	it.each([
		{ id: "cs_other" },
		{ client_reference_id: "other" },
		{ metadata: { checkoutReference: "other" } },
		{ livemode: true },
		{ livemode: undefined },
		{ mode: "setup" },
		{ mode: "payment" },
	])("rejects foreign or wrong-mode recovery result %j", async (extra) => {
		const provider = createStripeProvider({
			...stripeConfig,
			fetch: vi.fn<typeof fetch>(async () =>
				Response.json(stripeSession(extra)),
			),
		});
		await expect(
			provider.reconcileCheckout?.({
				reference: input.reference,
				sessionId: "cs_review",
				recovery: input,
			}),
		).rejects.toMatchObject({ code: "RETRY" });
	});
	it("verifies checkout expiration/completion without granting paid access", async () => {
		const provider = createStripeProvider(stripeConfig);
		for (const [type, lifecycle] of [
			["checkout.session.expired", "expired"],
			["checkout.session.completed", "completed"],
		]) {
			const body = JSON.stringify(stripeEvent(type, stripeSession()));
			const signature = createHmac("sha256", stripeConfig.webhookSecret)
				.update(`${second}.${body}`)
				.digest("hex");
			await expect(
				provider.verifyWebhook(
					body,
					new Headers({ "stripe-signature": `t=${second},v1=${signature}` }),
				),
			).resolves.toMatchObject({ effect: "sync", lifecycle });
		}
	});
});

describe("checkout create outcome classification", () => {
	it.each([
		[
			400,
			{ type: "invalid_request_error", code: "parameter_missing" },
			"not_created",
		],
		[
			400,
			{ type: "invalid_request_error", code: "idempotency_key_in_use" },
			"unknown",
		],
		[400, { type: "idempotency_error" }, "unknown"],
		[400, { type: "invalid_request_error" }, "unknown"],
		[401, {}, "not_created"],
		[403, {}, "not_created"],
		[409, {}, "unknown"],
		[429, {}, "unknown"],
		[500, {}, "unknown"],
	])("classifies Stripe HTTP %s (%j) as %s", async (status, error, outcome) => {
		const provider = createStripeProvider({
			...stripeConfig,
			fetch: vi.fn<typeof fetch>(async () =>
				Response.json({ error }, { status }),
			),
		});
		await expect(provider.createCheckout(input)).rejects.toMatchObject({
			code: "PROVIDER_ERROR",
			details: { outcome, upstreamStatus: status },
		});
	});
	it.each([401, 403, 409, 500])(
		"classifies Creem HTTP %s conservatively",
		async (status) => {
			const provider = createCreemProvider({
				...creemConfig,
				fetch: vi.fn<typeof fetch>(async () => Response.json({}, { status })),
			});
			await expect(provider.createCheckout(input)).rejects.toMatchObject({
				code: "PROVIDER_ERROR",
				details: {
					outcome: status === 401 || status === 403 ? "not_created" : "unknown",
					upstreamStatus: status,
				},
			});
		},
	);
	it("keeps network and successful malformed JSON outcomes unknown for both providers", async () => {
		for (const fetch of [
			vi.fn<typeof globalThis.fetch>(async () => {
				throw new Error("timeout");
			}),
			vi.fn<typeof globalThis.fetch>(async () => new Response("not json")),
		]) {
			for (const provider of [
				createStripeProvider({ ...stripeConfig, fetch }),
				createCreemProvider({ ...creemConfig, fetch }),
			])
				await expect(provider.createCheckout(input)).rejects.toMatchObject({
					code: "PROVIDER_ERROR",
					details: { outcome: "unknown" },
				});
		}
	});
});

describe("Creem reconciliation and resume", () => {
	it("reuses the mapped customer id rather than creating by email", async () => {
		const transport = vi.fn<typeof fetch>(async () =>
			Response.json(creemSession()),
		);
		const result = await createCreemProvider({
			...creemConfig,
			fetch: transport,
		}).createCheckout(input);
		expect(
			JSON.parse(transport.mock.calls[0]?.[1]?.body as string).customer,
		).toEqual({ id: "cus_existing" });
		expect(result.customerId).toBe("cust_existing");
	});
	it("does not replay a lost create even with recovery data", async () => {
		const transport = vi.fn<typeof fetch>();
		const provider = createCreemProvider({ ...creemConfig, fetch: transport });
		await expect(
			provider.reconcileCheckout?.({
				reference: input.reference,
				recovery: input,
			}),
		).resolves.toEqual({ lifecycle: "unknown" });
		expect(transport).not.toHaveBeenCalled();
	});
	it.each([
		["pending", "open"],
		["processing", "open"],
		["completed", "completed"],
		["expired", "expired"],
		["canceled", "unknown"],
	])("retrieves documented status %s as %s", async (status, lifecycle) => {
		const transport = vi.fn<typeof fetch>(async () =>
			Response.json(creemSession({ status })),
		);
		const provider = createCreemProvider({ ...creemConfig, fetch: transport });
		await expect(
			provider.reconcileCheckout?.({
				reference: input.reference,
				sessionId: "ch_review",
			}),
		).resolves.toMatchObject({ lifecycle });
		expect(transport.mock.calls[0]?.[0]).toBe(
			"https://test-api.creem.io/v1/checkouts?checkout_id=ch_review",
		);
		expect(transport.mock.calls[0]?.[1]).toMatchObject({
			method: "GET",
			body: undefined,
		});
	});
	it.each([
		{ id: "ch_other" },
		{ request_id: "other" },
		{ metadata: { checkoutReference: "other" } },
		{ request_id: null, metadata: {} },
		{ mode: "prod" },
		{ mode: undefined },
	])("rejects uncorrelated or wrong-mode checkout %j", async (extra) => {
		const provider = createCreemProvider({
			...creemConfig,
			fetch: vi.fn<typeof fetch>(async () =>
				Response.json(creemSession(extra)),
			),
		});
		await expect(
			provider.reconcileCheckout?.({
				reference: input.reference,
				sessionId: "ch_review",
			}),
		).rejects.toMatchObject({ code: "RETRY" });
	});
	it("allows a matching request_id if optional metadata is absent, and sandbox mode", async () => {
		const provider = createCreemProvider({
			...creemConfig,
			fetch: vi.fn<typeof fetch>(async () =>
				Response.json(creemSession({ metadata: undefined, mode: "sandbox" })),
			),
		});
		await expect(
			provider.reconcileCheckout?.({
				reference: input.reference,
				sessionId: "ch_review",
			}),
		).resolves.toMatchObject({ lifecycle: "open" });
	});
	it.each(["subscription.active", "subscription.update"])(
		"explicitly clears scheduled cancellation on %s",
		(type) => {
			expect(
				normalizeCreemEvent(
					creemEvent(type, { id: "sub_review", status: "active" }),
				),
			).toMatchObject({
				effect: "sync",
				state: "active",
				cancelAtPeriodEnd: false,
			});
		},
	);
	it("keeps completed checkout lifecycle distinct from recurring paid access", () => {
		expect(
			normalizeCreemEvent(
				creemEvent("checkout.completed", {
					id: "ch_review",
					subscription: "sub_review",
				}),
			),
		).toMatchObject({ effect: "sync", lifecycle: "completed" });
	});
});

describe("authoritative subscription observations", () => {
	it.each(["stripe", "creem"])(
		"%s reconciles current state with millisecond time and unique event id, never granting",
		async (name) => {
			const response =
				name === "stripe"
					? {
							id: "sub_review",
							livemode: false,
							status: "active",
							cancel_at_period_end: false,
							items: {
								data: [
									{
										id: "si_review",
										price: "price_pro",
										current_period_start: second,
										current_period_end: second + 86400,
									},
								],
							},
						}
					: {
							id: "sub_review",
							mode: "test",
							status: "active",
							product: "price_pro",
							current_period_start_date: new Date(second * 1000).toISOString(),
							current_period_end_date: new Date(
								(second + 86400) * 1000,
							).toISOString(),
						};
			const transport = vi.fn<typeof fetch>(async () =>
				Response.json(response),
			);
			const provider =
				name === "stripe"
					? createStripeProvider({ ...stripeConfig, fetch: transport })
					: createCreemProvider({ ...creemConfig, fetch: transport });
			const first = await provider.reconcileSubscription?.("sub_review");
			const next = await provider.reconcileSubscription?.("sub_review");
			expect(first).toMatchObject({
				type: "subscription.reconciled",
				effect: "sync",
				state: "active",
				occurredAt: now,
				cancelAtPeriodEnd: false,
				lookup: { subscriptionId: "sub_review" },
			});
			expect(first?.id).not.toBe(next?.id);
			expect(transport.mock.calls[0]?.[1]).toMatchObject({
				method: "GET",
				body: undefined,
			});
			if (name === "creem")
				expect(transport.mock.calls[0]?.[0]).toBe(
					"https://test-api.creem.io/v1/subscriptions?subscription_id=sub_review",
				);
		},
	);
	it.each(["stripe", "creem"])(
		"%s canceled snapshot revokes even without price items",
		async (name) => {
			const response = {
				id: "sub_review",
				livemode: false,
				mode: "test",
				status: "canceled",
			};
			const fetch = vi.fn<typeof globalThis.fetch>(async () =>
				Response.json(response),
			);
			const provider =
				name === "stripe"
					? createStripeProvider({ ...stripeConfig, fetch })
					: createCreemProvider({ ...creemConfig, fetch });
			await expect(
				provider.reconcileSubscription?.("sub_review"),
			).resolves.toMatchObject({ effect: "revoke", state: "canceled" });
		},
	);
	it.each(["stripe", "creem"])(
		"%s rejects a wrong subscription identity or unknown state",
		async (name) => {
			for (const extra of [{ id: "sub_other" }, { status: "future_status" }]) {
				const fetch = vi.fn<typeof globalThis.fetch>(async () =>
					Response.json({
						id: "sub_review",
						livemode: false,
						mode: "test",
						status: "active",
						...extra,
					}),
				);
				const provider =
					name === "stripe"
						? createStripeProvider({ ...stripeConfig, fetch })
						: createCreemProvider({ ...creemConfig, fetch });
				await expect(
					provider.reconcileSubscription?.("sub_review"),
				).rejects.toMatchObject({ code: "RETRY" });
			}
		},
	);
});

describe("verified normalizer failure diagnostics", () => {
	it.each(["stripe", "creem"])(
		"%s exposes only a verified event id on normalizer failure",
		async (name) => {
			const payload =
				name === "stripe"
					? stripeEvent(
							"invoice.paid",
							invoice([line(), line("price_ambiguous")]),
						)
					: creemEvent("subscription.update", {
							id: "sub_review",
							mode: "test",
							status: "unrecognized_status",
						});
			const body = JSON.stringify(payload);
			const provider =
				name === "stripe"
					? createStripeProvider(stripeConfig)
					: createCreemProvider(creemConfig);
			const headers =
				name === "stripe"
					? new Headers({
							"stripe-signature": `t=${second},v1=${createHmac("sha256", stripeConfig.webhookSecret).update(`${second}.${body}`).digest("hex")}`,
						})
					: new Headers({
							"creem-signature": createHmac("sha256", creemConfig.webhookSecret)
								.update(body)
								.digest("hex"),
						});
			await expect(provider.verifyWebhook(body, headers)).rejects.toMatchObject(
				{ code: "RETRY", details: { eventId: "evt_review" } },
			);
			try {
				await provider.verifyWebhook(`${body} `, headers);
				throw new Error("Expected invalid signature");
			} catch (error) {
				expect(error).toMatchObject({ code: "INVALID_SIGNATURE" });
				expect(error).not.toHaveProperty("details.eventId");
			}
		},
	);
});
