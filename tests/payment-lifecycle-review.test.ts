import { describe, it, expect, vi } from "vitest";
import {
	foldPaymentEvents,
	hasPaymentAccess,
	isCheckoutTerminalWithoutSubscription,
} from "../src/payment/entitlements";
import {
	createPaymentService,
	paymentWebhookResponse,
} from "../src/payment/service";
import {
	PaymentError,
	type CheckoutRecord,
	type PaymentEvent,
	type PaymentStore,
	type PaymentAdapter,
} from "../src/payment/types";
const now = 1_800_000_000_000;
const user = { id: "review-user", email: "review@example.test" };
const checkout: CheckoutRecord = {
	reference: "review-checkout",
	userId: user.id,
	provider: "stripe",
	createdAt: now,
	plan: {
		id: "annual",
		priceId: "price-annual",
		kind: "subscription",
		amount: 9900,
		currency: "USD",
	},
};
const fact = (overrides: Partial<PaymentEvent> = {}): PaymentEvent => ({
	provider: "stripe",
	id: "invoice-new",
	type: "invoice.paid",
	effect: "grant",
	state: "active",
	occurredAt: now,
	periodStart: now - 1,
	periodEnd: now + 86400000,
	plan: checkout.plan,
	lookup: {
		checkoutReference: checkout.reference,
		subscriptionId: "sub-review",
	},
	checkoutReference: checkout.reference,
	...overrides,
});
function present<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw Error("Missing test fixture");
	return value;
}
function setup(providerOverrides: Partial<PaymentAdapter> = {}) {
	const rows: CheckoutRecord[] = [];
	const events: PaymentEvent[] = [];
	const customers = new Map<string, string>();
	const store: PaymentStore = {
		async createCheckout(row) {
			rows.push({ ...row });
		},
		async attachCheckout(_, reference, sessionId) {
			Object.assign(present(rows.find((row) => row.reference === reference)), {
				sessionId,
				lifecycle: "open",
			});
		},
		async setCheckoutLifecycle(_, reference, lifecycle) {
			Object.assign(present(rows.find((row) => row.reference === reference)), {
				lifecycle,
			});
		},
		async findCheckout(provider, lookup) {
			return (
				rows.find(
					(row) =>
						row.provider === provider &&
						(row.reference === lookup.checkoutReference ||
							(row.sessionId && row.sessionId === lookup.sessionId)),
				) ?? null
			);
		},
		async listCheckouts(userId) {
			return rows.filter((row) => row.userId === userId);
		},
		async listEvents(_, reference) {
			return events.filter((event) => event.checkoutReference === reference);
		},
		async appendEvent(event) {
			if (events.some((old) => old.id === event.id)) return "duplicate";
			events.push(event);
			return "inserted";
		},
		async getCustomer(id, provider) {
			return customers.get(`${id}:${provider}`);
		},
		async bindCustomer(id, provider, customer) {
			const key = `${id}:${provider}`;
			if (!customers.has(key)) customers.set(key, customer);
			return present(customers.get(key));
		},
	};
	const provider: PaymentAdapter = {
		id: "stripe",
		createCheckout: vi.fn(async () => ({
			sessionId: "cs-review",
			url: "https://checkout.example.test",
		})),
		createPortal: vi.fn(async () => "https://portal.example.test"),
		cancelSubscription: vi.fn(async () => {}),
		verifyWebhook: vi.fn(async () => fact()),
		...providerOverrides,
	};
	const service = createPaymentService({
		provider,
		store,
		plans: [checkout.plan],
		appOrigin: "https://app.example.test",
		now: () => now,
		newReference: () => checkout.reference,
	});
	return { rows, events, store, provider, service };
}
describe("review payment lifecycle invariants", () => {
	it("never regresses paid service period or plan on a later paid old invoice", () => {
		const older = fact({
			id: "old-invoice",
			occurredAt: now + 1000,
			periodStart: now - 2 * 86400000,
			periodEnd: now - 86400000,
			plan: { ...checkout.plan, id: "monthly", priceId: "price-monthly" },
		});
		for (const sequence of [
			[fact(), older],
			[older, fact()],
		]) {
			const snapshot = foldPaymentEvents(checkout, sequence);
			expect(snapshot.periodEnd).toBe(now + 86400000);
			expect(snapshot.plan.id).toBe("annual");
			expect(hasPaymentAccess(snapshot, now)).toBe(true);
		}
	});
	it("flags same-second cancellation conflict without ordering opaque IDs", () => {
		const cancel = fact({
			id: "z-cancel",
			effect: "sync",
			occurredAt: now + 1000,
			cancelAtPeriodEnd: true,
		});
		const resume = fact({
			id: "a-resume",
			effect: "sync",
			occurredAt: now + 1000,
			cancelAtPeriodEnd: false,
		});
		const first = foldPaymentEvents(checkout, [fact(), cancel, resume]);
		const second = foldPaymentEvents(checkout, [resume, fact(), cancel]);
		expect(first).toEqual(second);
		expect(first.reconciliationRequired).toBe(true);
		const observed = fact({
			id: "provider-observation",
			type: "subscription.reconciled",
			effect: "sync",
			occurredAt: now + 1001,
			cancelAtPeriodEnd: false,
		});
		const fixed = foldPaymentEvents(checkout, [
			cancel,
			fact(),
			resume,
			observed,
		]);
		expect(fixed.cancelAtPeriodEnd).toBe(false);
		expect(fixed.reconciliationRequired).toBe(false);
	});
	it("never extends or resurrects paid coverage from an authoritative status read", () => {
		const snapshot = foldPaymentEvents(checkout, [
			fact(),
			fact({
				id: "canceled",
				effect: "revoke",
				state: "canceled",
				occurredAt: now + 1,
			}),
			fact({
				id: "read",
				effect: "sync",
				type: "subscription.reconciled",
				state: "active",
				periodEnd: now + 999999999,
				occurredAt: now + 2,
			}),
		]);
		expect(snapshot.periodEnd).toBe(now + 86400000);
		expect(snapshot.state).toBe("canceled");
	});
	it.each(["failed", "expired"] as const)(
		"only %s without any subscription is deletion-safe",
		(lifecycle) => {
			expect(
				isCheckoutTerminalWithoutSubscription(
					foldPaymentEvents({ ...checkout, lifecycle }, []),
				),
			).toBe(true);
			expect(
				isCheckoutTerminalWithoutSubscription(
					foldPaymentEvents({ ...checkout, lifecycle }, [
						fact({ effect: "sync" }),
					]),
				),
			).toBe(false);
			for (const unsafe of [
				"creating",
				"open",
				"unknown",
				"completed",
			] as const)
				expect(
					isCheckoutTerminalWithoutSubscription(
						foldPaymentEvents({ ...checkout, lifecycle: unsafe }, []),
					),
				).toBe(false);
		},
	);
	it("persists unknown transport outcomes, then expires only after provider reconciliation", async () => {
		const state = setup({
			createCheckout: vi.fn(async () => {
				throw Error("transport timeout");
			}),
			reconcileCheckout: vi.fn(async () => ({
				lifecycle: "expired" as const,
				sessionId: "cs-review",
			})),
		});
		await expect(
			state.service.createCheckout(user, { priceId: checkout.plan.priceId }),
		).rejects.toThrow();
		expect(state.rows[0].lifecycle).toBe("unknown");
		const current = await state.service.reconcileCheckout(
			user,
			checkout.reference,
		);
		expect(current.lifecycle).toBe("expired");
		expect(current.paid).toBe(false);
		expect(
			isCheckoutTerminalWithoutSubscription(
				foldPaymentEvents(state.rows[0], state.events),
			),
		).toBe(true);
	});
	it("distinguishes a definite creation rejection from unknown failure", async () => {
		const state = setup({
			createCheckout: vi.fn(async () => {
				throw new PaymentError("PROVIDER_ERROR", "Rejected", {
					outcome: "not_created",
					upstreamStatus: 400,
				});
			}),
		});
		await expect(
			state.service.createCheckout(user, { priceId: checkout.plan.priceId }),
		).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
		expect(state.rows[0].lifecycle).toBe("failed");
	});
	it("does not replay unknown creation beyond safe idempotency retention", async () => {
		const reconcile = vi.fn<NonNullable<PaymentAdapter["reconcileCheckout"]>>(
			async () => ({ lifecycle: "unknown" as const }),
		);
		const state = setup({ reconcileCheckout: reconcile });
		state.rows.push({
			...checkout,
			createdAt: now - 24 * 3600000,
			lifecycle: "unknown",
			recovery: {
				user,
				plan: checkout.plan,
				reference: checkout.reference,
				successUrl: "https://app.example.test/ok",
				cancelUrl: "https://app.example.test/no",
			},
		});
		const result = await state.service.reconcileCheckout(
			user,
			checkout.reference,
		);
		expect(reconcile.mock.calls[0][0].recovery).toBeUndefined();
		expect(result.lifecycle).toBe("unknown");
	});
	it("reuses stable customers and resolves historical portals only through owned references", async () => {
		const ensureCustomer = vi.fn(async () => "cus-stable");
		const state = setup({ ensureCustomer });
		await state.service.createCheckout(user, {
			priceId: checkout.plan.priceId,
		});
		expect(state.provider.createCheckout).toHaveBeenCalledWith(
			expect.objectContaining({ customerId: "cus-stable" }),
		);
		await state.service.createPortal(user);
		expect(state.provider.createPortal).toHaveBeenCalledWith(
			expect.objectContaining({ customerId: "cus-stable" }),
		);
		state.rows.push({ ...checkout, reference: "historical" });
		state.events.push(
			fact({
				id: "historic",
				checkoutReference: "historical",
				lookup: { customerId: "cus-old" },
			}),
		);
		await state.service.createPortal(user, undefined, "historical");
		expect(state.provider.createPortal).toHaveBeenLastCalledWith(
			expect.objectContaining({ customerId: "cus-old" }),
		);
	});
	it("continues existing webhook handling when new checkout is disabled", async () => {
		const state = setup();
		state.rows.push(checkout);
		const response = await paymentWebhookResponse(
			new Request("https://app.example.test/webhook", {
				method: "POST",
				body: "{}",
			}),
			{
				enabled: false,
				configuredProvider: "stripe",
				routeProvider: "stripe",
				service: state.service,
			},
		);
		expect(response.status).toBe(200);
		expect(state.events).toHaveLength(1);
	});
	it("holds all unresolved ambiguity until authoritative reconciliation", () => {
		const snapshot = foldPaymentEvents(checkout, [
			fact(),
			fact({
				id: "other-subscription",
				lookup: {
					checkoutReference: checkout.reference,
					subscriptionId: "sub-other",
				},
			}),
		]);
		expect(snapshot.reconciliationRequired).toBe(true);
		expect(snapshot.state).toBe("pending");
		expect(hasPaymentAccess(snapshot, now)).toBe(false);
		const cancellation = foldPaymentEvents(checkout, [
			fact(),
			fact({ id: "cancel", effect: "sync", cancelAtPeriodEnd: true }),
			fact({ id: "resume", effect: "sync", cancelAtPeriodEnd: false }),
		]);
		expect(cancellation.reconciliationRequired).toBe(true);
		expect(hasPaymentAccess(cancellation, now)).toBe(false);
	});
	it("resolves ambiguous current status with an authoritative observation without extending paid coverage", () => {
		const states = [
			fact(),
			fact({
				id: "a",
				effect: "sync",
				state: "active",
				occurredAt: now + 1000,
			}),
			fact({
				id: "z",
				effect: "sync",
				state: "past_due",
				occurredAt: now + 1000,
			}),
		];
		expect(foldPaymentEvents(checkout, states).state).toBe("pending");
		const fixed = foldPaymentEvents(checkout, [
			...states,
			fact({
				id: "observed",
				type: "subscription.reconciled",
				effect: "sync",
				state: "active",
				occurredAt: now + 1001,
				periodEnd: now + 999999999,
			}),
		]);
		expect(fixed.state).toBe("active");
		expect(fixed.periodEnd).toBe(now + 86400000);
		expect(fixed.reconciliationRequired).toBe(false);
	});
	it("persists only verified identifiers when normalization fails before returning an event", async () => {
		const state = setup({
			verifyWebhook: vi.fn(async () => {
				throw new PaymentError("RETRY", "Ambiguous lines", {
					eventId: "evt-verified",
				});
			}),
		});
		state.store.recordWebhookFailure = vi.fn(async () => {});
		await expect(
			state.service.handleWebhook("not logged", new Headers()),
		).rejects.toMatchObject({ code: "RETRY" });
		expect(state.store.recordWebhookFailure).toHaveBeenCalledWith({
			provider: "stripe",
			eventId: "evt-verified",
			code: "RETRY",
			at: now,
		});
	});
	it("selects an existing shorter paid interval after a legitimate plan reset", () => {
		const monthly = {
			...checkout.plan,
			id: "monthly",
			priceId: "price-monthly",
		};
		const annual = fact({
			id: "paid-annual",
			occurredAt: now - 2000,
			periodStart: now - 30 * 86400000,
			periodEnd: now + 335 * 86400000,
		});
		const changed = fact({
			id: "paid-monthly",
			occurredAt: now - 1000,
			periodStart: now,
			periodEnd: now + 30 * 86400000,
			plan: monthly,
		});
		const observed = fact({
			id: "current-monthly",
			type: "subscription.reconciled",
			effect: "sync",
			occurredAt: now,
			periodStart: now,
			periodEnd: now + 30 * 86400000,
			plan: monthly,
		});
		for (const sequence of [
			[annual, changed, observed],
			[observed, changed, annual],
		]) {
			const projected = foldPaymentEvents(checkout, sequence);
			expect(projected.plan.id).toBe("monthly");
			expect(projected.periodEnd).toBe(now + 30 * 86400000);
			expect(hasPaymentAccess(projected, now)).toBe(true);
		}
	});
	it("an authoritative plan observation only resolves conflicting grants by matching a paid interval", () => {
		const other = { ...checkout.plan, id: "other", priceId: "price-other" };
		const old = fact();
		const conflict = fact({ id: "other-grant", plan: other });
		const observed = fact({
			id: "observed-other",
			effect: "sync",
			type: "subscription.reconciled",
			occurredAt: now + 1,
			plan: other,
		});
		const fixed = foldPaymentEvents(checkout, [old, conflict, observed]);
		expect(fixed.plan.id).toBe("other");
		expect(fixed.reconciliationRequired).toBe(false);
		expect(hasPaymentAccess(fixed, now)).toBe(true);
		const noMatch = foldPaymentEvents(checkout, [
			old,
			conflict,
			{ ...observed, plan: { ...other, priceId: "not-paid" } },
		]);
		expect(hasPaymentAccess(noMatch, now)).toBe(false);
	});
	it("recovers a missed subscription cancellation webhook even without an ambiguity flag", async () => {
		const reconcileSubscription = vi.fn(async () =>
			fact({
				id: "verified-canceled",
				type: "subscription.reconciled",
				effect: "revoke",
				state: "canceled",
				occurredAt: now + 1,
			}),
		);
		const state = setup({ reconcileSubscription });
		state.rows.push(checkout);
		state.events.push(fact());
		const result = await state.service.reconcileCheckout(
			user,
			checkout.reference,
		);
		expect(reconcileSubscription).toHaveBeenCalledWith("sub-review");
		expect(result.state).toBe("canceled");
		expect(result.hasAccess).toBe(false);
	});
});
