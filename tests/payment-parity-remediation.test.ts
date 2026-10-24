import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createPaymentService,
	createPaymentProviderFacade,
	createRegisteredPaymentProvider,
	providerRegistry,
	isRegisteredPaymentProvider,
	normalizeWaffoEvent,
	foldPaymentEvents,
	hasPaymentAccess,
	type CheckoutRecord,
	type PaymentEvent,
	type PaymentAdapter,
	type PaymentProvider,
	type CreateCheckoutParams,
	type CheckoutResult,
	type CreatePortalParams,
	type PortalResult,
	type PaymentStore,
} from "../src/payment";
import { paymentApplicationOrigin } from "../src/payment/utils";
import { paymentNamespaceIdentity } from "../src/payment/namespace";

const user = { id: "parity-owner", email: "parity@example.test" };
const monthly = {
	id: "pro-monthly",
	priceId: "product-monthly",
	kind: "subscription" as const,
	amount: 1900,
	currency: "USD",
};
const annual = {
	...monthly,
	id: "pro-yearly",
	priceId: "product-yearly",
	amount: 19000,
};
const now = Date.parse("2026-10-24T00:00:00Z");
function setup(
	providerOverrides: Partial<PaymentAdapter> = {},
	providerId = "waffo",
) {
	const row: CheckoutRecord = {
		reference: "parity-reference",
		userId: user.id,
		provider: providerId,
		createdAt: now - 1000,
		plan: annual,
		lifecycle: "open",
		sessionId: "session-original",
	};
	const events: PaymentEvent[] = [];
	const store: PaymentStore = {
		createCheckout: async () => {},
		attachCheckout: async (_, reference, sessionId) => {
			if (reference === row.reference) row.sessionId = sessionId;
		},
		findCheckout: async (provider, lookup) =>
			provider === row.provider &&
			(lookup.checkoutReference === row.reference ||
				lookup.sessionId === row.sessionId ||
				events.some((event) =>
					Object.entries(lookup).some(
						([key, value]) =>
							value && event.lookup[key as keyof typeof lookup] === value,
					),
				))
				? row
				: null,
		listCheckouts: async (id) => (id === user.id ? [row] : []),
		listEvents: async () => events,
		appendEvent: async (event) => {
			if (events.some((prior) => prior.id === event.id)) return "duplicate";
			events.push(event);
			return "inserted";
		},
	};
	const provider: PaymentAdapter = {
		id: providerId,
		createCheckout: vi.fn(async () => ({
			sessionId: "created",
			url: "https://pay.example.test/checkout",
		})),
		createPortal: vi.fn(async () => "https://pay.example.test/portal"),
		cancelSubscription: vi.fn(async () => {}),
		verifyWebhook: async (raw) => normalizeWaffoEvent(JSON.parse(raw)),
		...providerOverrides,
	};
	const service = createPaymentService({
		provider,
		store,
		plans: [monthly, annual],
		appOrigin: "https://app.example.test",
		now: () => now,
	});
	return { row, events, store, provider, service };
}
function payload(type: string, changes: Record<string, unknown> = {}) {
	return {
		eventType: type,
		eventId: type === "subscription.activated" ? "order-old" : "order-new",
		timestamp:
			type === "subscription.activated"
				? "2026-01-01T12:00:00Z"
				: "2026-10-01T12:00:00Z",
		data: {
			orderId: type === "subscription.activated" ? "order-old" : "order-new",
			orderMerchantExternalId: "parity-reference",
			orderMetadata: { planId: annual.id },
			productMetadata: {
				priceId:
					type === "subscription.activated" ? annual.priceId : monthly.priceId,
			},
			currentPeriodStart:
				type === "subscription.activated" ? "2026-01-01" : "2026-10-01",
			currentPeriodEnd:
				type === "subscription.activated" ? "2027-01-01" : "2026-11-01",
			planChange: { direction: "downgrade", chargedAmount: "19.00" },
			...changes,
		},
	};
}
async function deliver(
	service: ReturnType<typeof createPaymentService>,
	value: ReturnType<typeof payload>,
) {
	return service.handleWebhook(JSON.stringify(value), new Headers());
}

describe("Waffo raw payload to ledger service", () => {
	it.each([false, true])(
		"uses the applied shorter new order in either delivery order (reverse=%s)",
		async (reverse) => {
			const { row, events, service } = setup();
			const facts = [
				payload("subscription.activated"),
				payload("subscription.plan_changed"),
			];
			for (const fact of reverse ? facts.reverse() : facts)
				await deliver(service, fact);
			const current = foldPaymentEvents(row, events);
			expect(current.plan.id).toBe(monthly.id);
			expect(current.periodEnd).toBe(Date.parse("2026-11-01"));
			expect(current.references.subscriptionId).toBe("order-new");
			expect(current.reconciliationRequired).toBe(false);
			expect(hasPaymentAccess(current, now)).toBe(true);
			expect(hasPaymentAccess(current, Date.parse("2026-11-02"))).toBe(false);
			expect(
				await deliver(service, payload("subscription.plan_changed")),
			).toEqual({ status: "duplicate" });
			expect(events).toHaveLength(2);
		},
	);
	it.each([false, true])(
		"handles same-day resets and longer periods (reverse=%s)",
		async (reverse) => {
			for (const end of ["2026-02-01", "2028-01-01"]) {
				const { row, events, service } = setup();
				const changed = payload("subscription.plan_changed", {
					currentPeriodStart: "2026-01-01",
					currentPeriodEnd: end,
				});
				changed.timestamp = "2026-01-01T13:00:00Z";
				const facts = [payload("subscription.activated"), changed];
				for (const fact of reverse ? facts.reverse() : facts)
					await deliver(service, fact);
				const current = foldPaymentEvents(row, events);
				expect(current.plan.id).toBe(monthly.id);
				expect(current.periodEnd).toBe(Date.parse(end));
				expect(current.references.subscriptionId).toBe("order-new");
			}
		},
	);
	it("does not apply a scheduled/failed change and applies only its later successful outcome", async () => {
		const { row, events, service } = setup();
		await deliver(service, payload("subscription.activated"));
		for (const type of [
			"subscription.plan_change_scheduled",
			"subscription.plan_change_failed",
		])
			expect(
				await deliver(
					service,
					payload(type, {
						currentPeriodStart: undefined,
						currentPeriodEnd: undefined,
						planChange: { direction: "downgrade", chargedAmount: null },
					}),
				),
			).toEqual({ status: "ignored" });
		expect(foldPaymentEvents(row, events).plan.id).toBe(annual.id);
		await deliver(service, payload("subscription.plan_changed"));
		expect(foldPaymentEvents(row, events).plan.id).toBe(monthly.id);
	});
	it.each([
		{ currentPeriodStart: undefined },
		{ currentPeriodStart: "invalid" },
		{ currentPeriodStart: "2026-02-31" },
		{ currentPeriodStart: "2026-02-31T12:00:00Z" },
		{ currentPeriodStart: "2026" },
		{ currentPeriodEnd: "invalid" },
		{ currentPeriodStart: "2026-12-01" },
	])("retries incomplete or invalid applied bounds %j", (data) => {
		expect(() =>
			normalizeWaffoEvent(payload("subscription.plan_changed", data)),
		).toThrow("service interval");
	});
	it.each(["subscription.canceled", "refund.succeeded"])(
		"preserves sticky %s across subsequent grants",
		async (type) => {
			const { row, events, service } = setup();
			await deliver(service, payload("subscription.activated"));
			await deliver(service, payload(type));
			await deliver(service, payload("subscription.plan_changed"));
			expect(hasPaymentAccess(foldPaymentEvents(row, events), now)).toBe(false);
		},
	);
});

describe("fresh owned checkout recovery URLs", () => {
	it("returns a fresh open URL without persisting it or exposing it through history/status", async () => {
		const recovery = vi.fn(async () => ({
			lifecycle: "open" as const,
			sessionId: "session-original",
			url: "https://pay.example.test/open?fixture=1",
		}));
		const { service, events } = setup(
			{ reconcileCheckout: recovery },
			"stripe",
		);
		expect(
			(await service.reconcileCheckout(user, "parity-reference")).checkoutUrl,
		).toBe("https://pay.example.test/open?fixture=1");
		expect(JSON.stringify(events)).not.toContain("pay.example");
		expect(
			await service.getCheckoutStatus(user, "parity-reference"),
		).not.toHaveProperty("checkoutUrl");
		expect(JSON.stringify(await service.getHistory(user))).not.toContain(
			"pay.example",
		);
		await expect(
			service.reconcileCheckout(
				{ ...user, id: "not-owner" },
				"parity-reference",
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(recovery).toHaveBeenCalledTimes(1);
	});
	it.each(["expired", "completed", "unknown"] as const)(
		"does not offer a URL for provider lifecycle %s",
		async (lifecycle) => {
			const { service } = setup(
				{
					reconcileCheckout: async () => ({
						lifecycle,
						url: "https://pay.example.test/open",
					}),
				},
				"stripe",
			);
			expect(
				await service.reconcileCheckout(user, "parity-reference"),
			).not.toHaveProperty("checkoutUrl");
		},
	);
	it("does not offer a URL once paid authority exists", async () => {
		const { service } = setup({
			reconcileCheckout: async () => ({
				lifecycle: "open",
				url: "https://pay.example.test/open",
			}),
		});
		await deliver(service, payload("subscription.activated"));
		expect(
			await service.reconcileCheckout(user, "parity-reference"),
		).not.toHaveProperty("checkoutUrl");
	});
	it("keeps Waffo unsupported rather than fabricating recovery", async () => {
		await expect(
			setup().service.reconcileCheckout(user, "parity-reference"),
		).rejects.toMatchObject({ code: "RETRY" });
	});
});

afterEach(() => {
	delete providerRegistry["fixture-pay"];
});
describe("single trusted provider registration and compatibility facade", () => {
	it("registers a custom adapter including namespace and uses the existing ledger engine", async () => {
		const { store, row, provider } = setup(
			{
				verifyWebhook: vi.fn(
					async (): Promise<PaymentEvent> => ({
						provider: "fixture-pay",
						id: "fixture-paid",
						type: "paid",
						occurredAt: now,
						effect: "grant",
						state: "active",
						periodStart: now - 1,
						periodEnd: now + 86400000,
						lookup: { checkoutReference: "parity-reference" },
					}),
				),
			},
			"fixture-pay",
		);
		providerRegistry["fixture-pay"] = {
			create: () => provider,
			credentialIdentity: (env) => env.FIXTURE_KEY,
			webhookSignatureHeader: "fixture-signature",
			requiresCustomerId: false,
			hostsPostCheckoutPage: true,
		};
		expect(isRegisteredPaymentProvider("fixture-pay")).toBe(true);
		expect(isRegisteredPaymentProvider("unknown-pay")).toBe(false);
		const registered = createRegisteredPaymentProvider(
			"fixture-pay",
			{ FIXTURE_KEY: "ordinary-test-fixture" },
			"test",
		);
		expect(
			(
				await paymentNamespaceIdentity(
					{ FIXTURE_KEY: "ordinary-test-fixture" },
					"fixture-pay",
				)
			).account,
		).toMatch(/^[0-9a-f]{64}$/);
		store.assertNamespace = vi.fn(async () => {});
		store.createCheckout = vi.fn(async () => {});
		const delegate = createPaymentProviderFacade({
			provider: registered.provider,
			store,
			plans: [annual],
			appOrigin: "https://app.example.test",
			newReference: () => "facade-created-reference",
			namespace: () =>
				paymentNamespaceIdentity(
					{
						FIXTURE_KEY: "ordinary-test-fixture",
						APP_URL: "https://app.example.test",
					},
					"fixture-pay",
				),
		});
		// This compiles using exactly the public method names. No internal id,
		// verifyWebhook or createPortal members, or mandatory flags, are required.
		class CustomPaymentProvider implements PaymentProvider {
			constructor(private readonly delegate: PaymentProvider) {}
			getProviderName(): string {
				return this.delegate.getProviderName();
			}
			createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
				return this.delegate.createCheckout(params);
			}
			createCustomerPortal(params: CreatePortalParams): Promise<PortalResult> {
				return this.delegate.createCustomerPortal(params);
			}
			handleWebhookEvent(payload: string, signature: string): Promise<void> {
				return this.delegate.handleWebhookEvent(payload, signature);
			}
		}
		const facade: PaymentProvider = new CustomPaymentProvider(delegate);
		expect(facade.getProviderName()).toBe("fixture-pay");
		expect(facade.requiresCustomerId).toBeUndefined();
		expect(delegate.requiresCustomerId).toBe(false);
		expect(delegate.hostsPostCheckoutPage).toBe(true);
		await facade.handleWebhookEvent("fixture-body", "fixture-signature-value");
		expect(provider.verifyWebhook).toHaveBeenCalledWith(
			"fixture-body",
			expect.any(Headers),
		);
		expect(
			vi
				.mocked(provider.verifyWebhook)
				.mock.calls[0]?.[1].get("fixture-signature"),
		).toBe("fixture-signature-value");
		expect(store.assertNamespace).toHaveBeenCalledWith(
			"fixture-pay",
			"test",
			expect.stringMatching(/^[0-9a-f]{64}$/),
			"https://app.example.test",
		);
		expect(await store.listEvents(row.provider, row.reference)).toHaveLength(1);
		expect(
			await facade.createCustomerPortal({ user, reference: row.reference }),
		).toEqual({ url: "https://pay.example.test/portal" });
		const created = await facade.createCheckout({
			user,
			priceId: annual.priceId,
		});
		expect(created.reference).toBe("facade-created-reference");
		expect(store.createCheckout).toHaveBeenCalledWith(
			expect.objectContaining({
				reference: created.reference,
				provider: "fixture-pay",
				userId: user.id,
			}),
		);
		const checkoutInput = vi.mocked(provider.createCheckout).mock.calls[0]?.[0];
		expect(checkoutInput?.reference).toBe(created.reference);
		expect(
			new URL(
				checkoutInput?.successUrl ?? "https://missing.example.test",
			).searchParams.get("reference"),
		).toBe(created.reference);
	});
});

describe("canonical payment application origin", () => {
	it("uses VITE_BASE_URL alone, accepts matching APP_URL and preserves server-only compatibility", () => {
		expect(
			paymentApplicationOrigin(undefined, "https://app.example.test/path"),
		).toBe("https://app.example.test");
		expect(
			paymentApplicationOrigin(
				"https://app.example.test",
				"https://app.example.test/",
			),
		).toBe("https://app.example.test");
		expect(paymentApplicationOrigin("https://legacy.example.test")).toBe(
			"https://legacy.example.test",
		);
	});
	it("rejects conflicting configured public and server origins", () => {
		expect(() =>
			paymentApplicationOrigin(
				"https://other.example.test",
				"https://app.example.test",
			),
		).toThrow("public payment origin");
	});
});
