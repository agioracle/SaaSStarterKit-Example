import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	createD1PaymentStore,
	checkPaymentNamespace,
	rebuildPaymentProjection,
} from "../src/db/payment-store";
import {
	createPaymentService,
	foldPaymentEvents,
	normalizeWaffoEvent,
	hasPaymentAccess,
	type CheckoutRecord,
	type PaymentEvent,
	type PaymentAdapter,
	type PaymentStore,
} from "../src/payment";

function present<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw Error("Missing test fixture");
	return value;
}
const now = 1_800_000_000_000;
const user = { id: "local-payment-user-1", email: "payment-1@example.test" };
const other = { id: "local-payment-user-2", email: "payment-2@example.test" };
const checkout: CheckoutRecord = {
	reference: "local-checkout-1",
	userId: user.id,
	provider: "stripe",
	plan: {
		id: "pro",
		priceId: "price_fixture",
		kind: "subscription",
		amount: 990,
		currency: "USD",
	},
	createdAt: now,
};
const payment = (
	overrides: Partial<PaymentEvent> = {},
): PaymentEvent & { checkoutReference: string } => ({
	provider: "stripe",
	id: "evt_fixture_1",
	type: "invoice.paid",
	occurredAt: now,
	effect: "grant",
	state: "active",
	periodEnd: now + 86400000,
	lookup: {
		checkoutReference: checkout.reference,
		subscriptionId: "sub_fixture_1",
		invoiceId: "in_fixture_1",
		paymentIntentId: "pi_fixture_1",
		orderId: "ord_fixture_1",
		customerId: "cus_fixture_1",
		sessionId: "cs_fixture_1",
	},
	...overrides,
	checkoutReference: overrides.checkoutReference ?? checkout.reference,
});

/** These are real local workerd/D1 tests, not mocked SQL or live Cloudflare resources. */
describe("D1 payment ledger integration", () => {
	let mf: Miniflare;
	let db: D1Database;
	let store: PaymentStore;

	beforeAll(async () => {
		mf = new Miniflare(
			convertV4MiniflareOptions({
				modules: true,
				script:
					'export default { fetch() { return new Response("local-payment-test"); } };',
				compatibilityDate: "2026-10-01",
				d1Databases: ["DB"],
			}),
		);
		db = (await mf.getD1Database("DB")) as unknown as D1Database;
		const migrationDirectory = fileURLToPath(
			new URL("../drizzle", import.meta.url),
		);
		const migrations = (await readdir(migrationDirectory))
			.filter((name) => name.endsWith(".sql"))
			.sort();
		expect(migrations.length).toBeGreaterThan(0);
		for (const migration of migrations) {
			const source = await readFile(
				`${migrationDirectory}/${migration}`,
				"utf8",
			);
			for (const statement of source
				.split("--> statement-breakpoint")
				.map((value) => value.trim())
				.filter(Boolean))
				await db.prepare(statement).run();
		}
		store = createD1PaymentStore(db);
	}, 30_000);

	beforeEach(async () => {
		await db.prepare("DELETE FROM user").run();
		for (const member of [user, other])
			await db
				.prepare(
					"INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)",
				)
				.bind(member.id, "Local Test User", member.email, 1, now, now)
				.run();
		await store.createCheckout(checkout);
		await store.attachCheckout("stripe", checkout.reference, "cs_fixture_1");
	});

	afterAll(async () => {
		if (mf) await mf.dispose();
	}, 30_000);

	it("applies the production migration and round-trips checkout ownership", async () => {
		const record = await store.findCheckout("stripe", {
			checkoutReference: checkout.reference,
		});
		expect(record).toEqual({
			...checkout,
			sessionId: "cs_fixture_1",
			lifecycle: "open",
		});
		expect(await store.listCheckouts(user.id)).toHaveLength(1);
		expect(await store.listCheckouts(other.id)).toEqual([]);
		expect(
			await store.findCheckout("creem", {
				checkoutReference: checkout.reference,
			}),
		).toBeNull();
	});

	it("atomically inserts one record for concurrent duplicate deliveries", async () => {
		const results = await Promise.all(
			Array.from({ length: 24 }, () => store.appendEvent(payment())),
		);
		expect(results.filter((value) => value === "inserted")).toHaveLength(1);
		expect(results.filter((value) => value === "duplicate")).toHaveLength(23);
		const count = await db
			.prepare("SELECT count(*) AS total FROM payment_events")
			.first<{ total: number }>();
		expect(count?.total).toBe(1);
		const snapshot = foldPaymentEvents(
			checkout,
			await store.listEvents("stripe", checkout.reference),
		);
		expect(hasPaymentAccess(snapshot, now)).toBe(true);
	});

	it("never overwrites the first event when a duplicate body changes", async () => {
		await store.appendEvent(payment());
		expect(
			await store.appendEvent(payment({ effect: "revoke", state: "refunded" })),
		).toBe("duplicate");
		const events = await store.listEvents("stripe", checkout.reference);
		expect(events).toHaveLength(1);
		expect(events[0]?.state).toBe("active");
	});

	it("uses distinct event identities for separate providers", async () => {
		const creemCheckout: CheckoutRecord = {
			...checkout,
			provider: "creem",
			reference: "local-creem-checkout",
		};
		await store.createCheckout(creemCheckout);
		expect(await store.appendEvent(payment())).toBe("inserted");
		expect(
			await store.appendEvent(
				payment({
					provider: "creem",
					checkoutReference: creemCheckout.reference,
				}),
			),
		).toBe("inserted");
		expect(await store.listEvents("stripe", checkout.reference)).toHaveLength(
			1,
		);
		expect(
			await store.listEvents("creem", creemCheckout.reference),
		).toHaveLength(1);
	});

	it("resolves each historical provider reference without using customer identity", async () => {
		await store.appendEvent(payment());
		await store.appendEvent(
			payment({
				id: "evt_renewal",
				occurredAt: now + 1,
				lookup: {
					subscriptionId: "sub_fixture_1",
					invoiceId: "in_fixture_2",
					paymentIntentId: "pi_fixture_2",
				},
			}),
		);
		const cases = [
			{ checkoutReference: checkout.reference },
			{ sessionId: "cs_fixture_1" },
			{ subscriptionId: "sub_fixture_1" },
			{ invoiceId: "in_fixture_1" },
			{ invoiceId: "in_fixture_2" },
			{ paymentIntentId: "pi_fixture_1" },
			{ paymentIntentId: "pi_fixture_2" },
			{ orderId: "ord_fixture_1" },
		];
		for (const lookup of cases)
			expect((await store.findCheckout("stripe", lookup))?.reference).toBe(
				checkout.reference,
			);
		expect(
			await store.findCheckout("stripe", { customerId: "cus_fixture_1" }),
		).toBeNull();
		expect(
			await store.findCheckout("stripe", { invoiceId: "' OR 1=1 --" }),
		).toBeNull();
		expect(
			await store.findCheckout("waffo", { invoiceId: "in_fixture_1" }),
		).toBeNull();
	});

	it("rejects ambiguous mixed references instead of choosing another order", async () => {
		await store.appendEvent(payment());
		const second = {
			...checkout,
			reference: "local-checkout-2",
			userId: other.id,
		};
		await store.createCheckout(second);
		await store.attachCheckout("stripe", second.reference, "cs_fixture_2");
		await expect(
			store.findCheckout("stripe", {
				checkoutReference: checkout.reference,
				sessionId: "cs_fixture_2",
			}),
		).rejects.toThrow("Ambiguous");
	});

	it("enforces foreign keys for missing checkout owners and missing event parents", async () => {
		await expect(
			store.createCheckout({
				...checkout,
				reference: "bad-owner",
				userId: "nonexistent-user",
			}),
		).rejects.toThrow();
		await expect(
			store.appendEvent(
				payment({ id: "orphan", checkoutReference: "missing-checkout" }),
			),
		).rejects.toThrow();
		expect(
			await db
				.prepare("SELECT count(*) AS total FROM payment_events")
				.first("total"),
		).toBe(0);
	});

	it("cascades account deletion to checkout and ledger records as declared by the schema", async () => {
		await store.appendEvent(payment());
		await db.prepare("DELETE FROM user WHERE id=?").bind(user.id).run();
		expect(
			await store.findCheckout("stripe", {
				checkoutReference: checkout.reference,
			}),
		).toBeNull();
		expect(await store.listEvents("stripe", checkout.reference)).toEqual([]);
	});

	it("projects out-of-order delivery deterministically and keeps receipts non-authoritative", async () => {
		await store.appendEvent(
			payment({
				id: "evt_canceled",
				occurredAt: now + 3,
				effect: "revoke",
				state: "canceled",
			}),
		);
		await store.appendEvent(
			payment({ id: "evt_context", occurredAt: now - 1, effect: "sync" }),
		);
		await store.appendEvent(payment());
		await store.appendEvent(
			payment({ id: "evt_receipt", occurredAt: now + 2, effect: "receipt" }),
		);
		const snapshot = foldPaymentEvents(
			checkout,
			await store.listEvents("stripe", checkout.reference),
		);
		expect(snapshot.state).toBe("canceled");
		expect(hasPaymentAccess(snapshot, now)).toBe(false);
	});

	it("enforces authenticated current-checkout access over the real D1 store", async () => {
		const provider: PaymentAdapter = {
			id: "stripe",
			async createCheckout() {
				throw new Error("No provider calls allowed in persistence tests");
			},
			async createPortal() {
				throw new Error("No provider calls allowed in persistence tests");
			},
			async cancelSubscription() {
				throw new Error("No provider calls allowed in persistence tests");
			},
			async verifyWebhook() {
				return payment();
			},
		};
		const service = createPaymentService({
			provider,
			plans: [checkout.plan],
			appOrigin: "https://app.example.test",
			store,
			now: () => now,
		});
		await service.handleWebhook("{}", new Headers());
		await expect(
			service.getCheckoutStatus(other, "cs_fixture_1"),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			service.getCheckoutStatus(null, "cs_fixture_1"),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(
			(await service.getCheckoutStatus(user, "cs_fixture_1")).hasAccess,
		).toBe(true);
		await store.createCheckout({
			...checkout,
			reference: "new-pending-checkout",
		});
		expect(
			(await service.getCheckoutStatus(user, "new-pending-checkout")).paid,
		).toBe(false);
	});
	it("keeps ledger and projection atomic under distinct concurrent updates", async () => {
		await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				store.appendEvent(
					payment({
						id: `concurrent-${index}`,
						occurredAt: now + index,
						periodEnd: now + (index + 1) * 86400000,
					}),
				),
			),
		);
		const projected = await store.getSnapshot?.("stripe", checkout.reference);
		const replay = foldPaymentEvents(
			present(
				await store.findCheckout("stripe", {
					checkoutReference: checkout.reference,
				}),
			),
			await store.listEvents("stripe", checkout.reference),
		);
		expect(projected?.periodEnd).toBe(replay.periodEnd);
		expect(projected?.periodEnd).toBe(now + 8 * 86400000);
		expect((await store.getEntitlement?.(user.id, now))?.reference).toBe(
			checkout.reference,
		);
	});

	it.each([0, 17, 100, 1000])(
		"bounds history and entitlement statements independently of %i pending rows",
		async (count) => {
			await store.appendEvent(payment());
			for (let start = 0; start < count; start += 100)
				await db.batch(
					Array.from({ length: Math.min(100, count - start) }, (_, offset) => {
						const ref = `pending-${String(start + offset).padStart(5, "0")}`;
						const row = {
							...checkout,
							reference: ref,
							createdAt: now + 1,
							lifecycle: "open" as const,
						};
						return db
							.prepare(
								"INSERT INTO payment_checkouts(reference,user_id,provider,plan,created_at,lifecycle,snapshot,access_kind) VALUES(?,?,?,?,?,?,?,?)",
							)
							.bind(
								ref,
								user.id,
								"stripe",
								JSON.stringify(row.plan),
								row.createdAt,
								"open",
								JSON.stringify(foldPaymentEvents(row, [])),
								row.plan.kind,
							);
					}),
				);
			let queries = 0;
			const instrumented = {
				prepare(sql: string) {
					queries++;
					return db.prepare(sql);
				},
				batch: db.batch.bind(db),
			} as D1Database;
			const bounded = createD1PaymentStore(instrumented);
			const page = await bounded.listHistory?.(user.id, { limit: 10 });
			const entitlement = await bounded.getEntitlement?.(user.id, now);
			expect(present(page).items.length).toBe(Math.min(10, count + 1));
			expect(entitlement?.reference).toBe(checkout.reference);
			expect(queries).toBe(3);
			if (count >= 17) {
				expect(
					present(page).items.some(
						(item) => item.reference === checkout.reference,
					),
				).toBe(false);
				expect(present(page).nextCursor).toBeTruthy();
			}
		},
		30000,
	);

	it("keyset-paginates mixed-provider history without losing authoritative access", async () => {
		await store.appendEvent(payment());
		await store.createCheckout({
			...checkout,
			reference: "creem-history",
			provider: "creem",
			createdAt: now + 1,
		});
		const provider: PaymentAdapter = {
			id: "creem",
			createCheckout: async () => {
				throw Error("no network");
			},
			createPortal: async () => "https://example.test",
			cancelSubscription: async () => {},
			verifyWebhook: async () => {
				throw Error("no network");
			},
		};
		const service = createPaymentService({
			provider,
			store,
			plans: [checkout.plan],
			appOrigin: "https://example.test",
			now: () => now,
		});
		const first = await service.getHistory(user, { limit: 1 });
		expect(first.checkouts[0]).toMatchObject({
			provider: "creem",
			canManage: true,
		});
		const second = await service.getHistory(user, {
			limit: 1,
			cursor: present(first.nextCursor),
		});
		expect(second.checkouts[0]).toMatchObject({
			provider: "stripe",
			canManage: false,
			hasAccess: true,
		});
		expect((await service.getEntitlement(user))?.reference).toBe(
			checkout.reference,
		);
		expect((await service.getHistory(other)).checkouts).toEqual([]);
	});

	it("fails closed for legacy projections and supports one-checkout rebuild", async () => {
		await store.appendEvent(payment());
		await db
			.prepare("UPDATE payment_checkouts SET snapshot=NULL WHERE reference=?")
			.bind(checkout.reference)
			.run();
		await expect(store.getEntitlement?.(user.id, now)).rejects.toMatchObject({
			code: "CONFIGURATION",
		});
		await rebuildPaymentProjection(db, "stripe", checkout.reference);
		expect((await store.getEntitlement?.(user.id, now))?.reference).toBe(
			checkout.reference,
		);
	});

	it("refuses to auto-adopt legacy data and pins both deployment and provider identity", async () => {
		await db.prepare("DELETE FROM payment_namespaces").run();
		await expect(
			store.assertNamespace?.("stripe", "test", "account-a", "deploy-a"),
		).rejects.toMatchObject({ code: "CONFIGURATION" });
		await db.prepare("DELETE FROM payment_checkouts").run();
		await store.assertNamespace?.("stripe", "test", "account-a", "deploy-a");
		await checkPaymentNamespace(db, "stripe", "test", "account-a", "deploy-a");
		await expect(
			store.assertNamespace?.("stripe", "live", "account-a", "deploy-a"),
		).rejects.toMatchObject({ code: "CONFIGURATION" });
		await expect(
			store.assertNamespace?.("creem", "live", "account-b", "deploy-a"),
		).rejects.toMatchObject({ code: "CONFIGURATION" });
		await expect(
			store.assertNamespace?.("stripe", "test", "account-b", "deploy-a"),
		).rejects.toMatchObject({ code: "CONFIGURATION" });
		await expect(
			store.assertNamespace?.("stripe", "test", "account-a", "deploy-b"),
		).rejects.toMatchObject({ code: "CONFIGURATION" });
		await db.prepare("DELETE FROM payment_namespaces").run();
	});

	it("stores safe webhook retry diagnostics and resolves them on successful replay", async () => {
		await store.recordWebhookFailure?.({
			provider: "stripe",
			eventId: "evt-fixture",
			code: "RETRY",
			at: now,
		});
		await store.recordWebhookFailure?.({
			provider: "stripe",
			eventId: "evt-fixture",
			code: "RETRY",
			at: now + 1,
		});
		const failure = await db
			.prepare(
				"SELECT * FROM payment_webhook_failures WHERE event_id='evt-fixture'",
			)
			.first<{ attempts: number; code: string }>();
		expect(failure).toMatchObject({ attempts: 2, code: "RETRY" });
		await store.resolveWebhookFailure?.("stripe", "evt-fixture");
		expect(
			await db
				.prepare("SELECT count(*) AS count FROM payment_webhook_failures")
				.first("count"),
		).toBe(0);
	});
	it("atomically reserves one unresolved recurring checkout across provider switches", async () => {
		await db.prepare("DELETE FROM payment_checkouts").run();
		const outcomes = await Promise.allSettled([
			store.reserveCheckout?.({
				...checkout,
				reference: "first",
				provider: "stripe",
			}),
			store.reserveCheckout?.({
				...checkout,
				reference: "second",
				provider: "creem",
			}),
		]);
		expect(
			outcomes.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			await db
				.prepare("SELECT count(*) AS count FROM payment_checkouts")
				.first("count"),
		).toBe(1);
	});
	it("a projection rebuild restores historical invoice indexes from pre-migration events", async () => {
		await store.appendEvent(payment());
		await db.prepare("DELETE FROM payment_references").run();
		await rebuildPaymentProjection(db, "stripe", checkout.reference);
		expect(
			(await store.findCheckout("stripe", { invoiceId: "in_fixture_1" }))
				?.reference,
		).toBe(checkout.reference);
	});
	it.each([false, true])("Waffo applied shorter plan persists through raw payload service and D1 (reverse=%s)", async (reverse) => {
		const annual = { ...checkout.plan, id: "pro-yearly", priceId: "product-yearly" };
		const monthly = { ...checkout.plan, id: "pro-monthly", priceId: "product-monthly" };
		await store.createCheckout({ ...checkout, reference: "waffo-change", provider: "waffo", plan: annual });
		const provider: PaymentAdapter = {
			id: "waffo",
			createCheckout: async () => { throw new Error("No provider calls in fixture"); },
			createPortal: async () => { throw new Error("No provider calls in fixture"); },
			cancelSubscription: async () => { throw new Error("No provider calls in fixture"); },
			verifyWebhook: async (raw) => normalizeWaffoEvent(JSON.parse(raw)),
		};
		const service = createPaymentService({ provider, store, plans: [annual, monthly], appOrigin: "https://app.example.test" });
		const facts = [
			{ eventType: "subscription.activated", eventId: "order-original", timestamp: "2026-01-01T12:00:00Z", data: { orderId: "order-original", orderMerchantExternalId: "waffo-change", productMetadata: { priceId: annual.priceId }, currentPeriodStart: "2026-01-01", currentPeriodEnd: "2027-01-01" } },
			{ eventType: "subscription.plan_changed", eventId: "order-changed", timestamp: "2026-10-01T12:00:00Z", data: { orderId: "order-changed", orderMerchantExternalId: "waffo-change", orderMetadata: { priceId: annual.priceId }, productMetadata: { priceId: monthly.priceId }, currentPeriodStart: "2026-10-01", currentPeriodEnd: "2026-11-01", planChange: { direction: "downgrade", chargedAmount: "19.00" } } },
		];
		for (const fact of reverse ? facts.reverse() : facts) await service.handleWebhook(JSON.stringify(fact), new Headers());
		const current = present(await store.getSnapshot?.("waffo", "waffo-change"));
		expect(current.plan.id).toBe(monthly.id);
		expect(current.periodEnd).toBe(Date.parse("2026-11-01"));
		expect(current.references.subscriptionId).toBe("order-changed");
		expect(current.reconciliationRequired).toBe(false);
		expect((await store.getEntitlement?.(user.id, Date.parse("2026-10-24")))?.plan.id).toBe(monthly.id);
		expect(await store.getEntitlement?.(user.id, Date.parse("2026-11-02"))).toBeNull();
		expect((await store.findCheckout("waffo", { orderId: "order-original" }))?.reference).toBe("waffo-change");
		expect((await store.findCheckout("waffo", { orderId: "order-changed" }))?.reference).toBe("waffo-change");
	});

});
