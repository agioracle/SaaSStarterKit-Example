import { websiteConfig } from "../src/config/website";
import { DEFAULT_AI_POLICY } from "../src/ai/policy";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Bindings } from "../src/env";
import type { GenerationInput } from "../src/generation/types";
import {
	generationPolicy,
	modelCatalog,
} from "../src/generation/policy.server";
import {
	existingRequest,
	ownedJob,
	publicJob,
	recoverStaleDispatch,
	requestHash,
	reserveJob,
	usage,
} from "../src/generation/store.server";
import { createD1PaymentStore } from "../src/db/payment-store";
import {
	prepareAccountDeletion,
	finishAccountDeletion,
} from "../src/auth/deletion.server";
import type { CheckoutRecord, PaymentEvent } from "../src/payment/types";
vi.mock("@tanstack/react-start/server-only", () => ({}));

const now = Date.parse("2026-10-24T04:00:00Z");
const policy = {
	plan: "free" as const,
	limit: 10,
	retainedLimit: 30,
	concurrencyLimit: 2,
};
const makeInput = (
	overrides: Partial<GenerationInput> = {},
): GenerationInput => ({
	model: "fal-flux-schnell",
	prompt: "A geometric blue cloud",
	aspectRatio: "1:1",
	idempotencyKey: crypto.randomUUID(),
	...overrides,
});

describe("Lumina independent store and entitlement functional regression", () => {
	let mf: Miniflare;
	let db: D1Database;
	let env: Bindings;
	let deletedObjects: string[];
	beforeAll(async () => {
		mf = new Miniflare(
			convertV4MiniflareOptions({
				modules: true,
				script:
					'export default {fetch(){return new Response("review fixture")}}',
				compatibilityDate: "2026-10-01",
				d1Databases: ["DB"],
			}),
		);
		db = (await mf.getD1Database("DB")) as unknown as D1Database;
		for (const filename of (await readdir("drizzle"))
			.filter((name) => name.endsWith(".sql"))
			.sort()) {
			for (const sql of (await readFile(`drizzle/${filename}`, "utf8"))
				.split("--> statement-breakpoint")
				.map((s) => s.trim())
				.filter(Boolean))
				await db.prepare(sql).run();
		}
		env = {
			DB: db,
			BUCKET: {
				delete: async (key: string) => {
					deletedObjects.push(key);
				},
			},
		} as unknown as Bindings;
	}, 30_000);
	beforeEach(async () => {
		await db
			.prepare("UPDATE generation_jobs SET billing_state='released'")
			.run();
		await db.prepare("DELETE FROM generation_capacity").run();
		await db.prepare("DELETE FROM user").run();
		await db.prepare("DELETE FROM account_deletions").run();
		for (const id of ["owner", "other"])
			await db
				.prepare(
					"INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)",
				)
				.bind(id, id, `${id}@example.test`, 1, now, now)
				.run();
		deletedObjects = [];
	});
	afterAll(async () => {
		await mf?.dispose();
	}, 30_000);
	async function reserve(input = makeInput(), at = now, limits = policy) {
		return reserveJob(db, "owner", input, await requestHash(input), limits, at);
	}
	async function grant(
		overrides: Partial<PaymentEvent> = {},
		kind: CheckoutRecord["plan"]["kind"] = "subscription",
	) {
		const checkout: CheckoutRecord = {
			reference: crypto.randomUUID(),
			userId: "owner",
			provider: "stripe",
			plan: {
				id: kind === "one_time" ? "lifetime" : "pro-monthly",
				kind,
				amount: 1900,
				currency: "USD",
				priceId: "price_fixture",
			},
			createdAt: now,
		};
		const store = createD1PaymentStore(db);
		await store.createCheckout(checkout);
		await store.attachCheckout(
			"stripe",
			checkout.reference,
			"redirect-session-does-not-grant",
		);
		if (overrides.effect)
			await store.appendEvent({
				provider: "stripe",
				id: crypto.randomUUID(),
				type: "invoice.paid",
				occurredAt: now - 1000,
				lookup: {},
				checkoutReference: checkout.reference,
				state: "active",
				periodEnd: now + 1000,
				...overrides,
			} as PaymentEvent & { checkoutReference: string });
		return checkout;
	}
	it("bounds simultaneous distinct reservations atomically by global concurrency", async () => {
		const settled = await Promise.allSettled(
			Array.from({ length: 20 }, () => reserve()),
		);
		expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(2);
		expect((await usage(db, "owner", policy, now)).active).toBe(2);
	});
	it("has exactly one provider-dispatch winner for simultaneous duplicate submissions", async () => {
		const input = makeInput();
		const results = await Promise.all(
			Array.from({ length: 15 }, () => reserve(input)),
		);
		expect(results.filter((result) => result.created)).toHaveLength(1);
		expect(new Set(results.map((result) => result.row.id)).size).toBe(1);
		expect((await usage(db, "owner", policy, now)).reserved).toBe(1);
	});
	it("does not let a new idempotency key cross the monthly charge boundary", async () => {
		const narrow = { ...policy, limit: 1 };
		const row = await reserve(makeInput(), now, narrow);
		await db
			.prepare(
				"UPDATE generation_jobs SET status='succeeded',billing_state='charged' WHERE id=?",
			)
			.bind(row.row.id)
			.run();
		await expect(reserve(makeInput(), now, narrow)).rejects.toMatchObject({
			status: 429,
		});
	});
	it("preserves idempotency and charged credit after image deletion", async () => {
		const input = makeInput();
		const result = await reserve(input);
		await db
			.prepare(
				"UPDATE generation_jobs SET status='deleted',billing_state='charged' WHERE id=?",
			)
			.bind(result.row.id)
			.run();
		const replay = await reserve(input);
		expect(replay.created).toBe(false);
		expect(replay.row.status).toBe("deleted");
		expect(await usage(db, "owner", policy, now)).toMatchObject({
			used: 1,
			reserved: 0,
			active: 0,
			retained: 0,
			remaining: 9,
		});
		const changed = { ...input, prompt: "different" };
		await expect(
			existingRequest(db, "owner", changed, await requestHash(changed)),
		).rejects.toMatchObject({ status: 409 });
	});
	it("keeps previous-month uncertain jobs in global concurrency but not new-month quota", async () => {
		const previous = Date.parse("2026-09-30T23:59:59Z");
		await reserve(makeInput(), previous);
		await reserve(makeInput(), previous);
		expect(await usage(db, "owner", policy, now)).toMatchObject({
			used: 0,
			reserved: 0,
			remaining: 10,
			active: 2,
		});
		await expect(reserve()).rejects.toMatchObject({ status: 429 });
	});
	it("charges late completion to its reservation month, not the month of polling", async () => {
		const first = await reserve(
			makeInput(),
			Date.parse("2026-09-30T23:59:59Z"),
		);
		await db
			.prepare(
				"UPDATE generation_jobs SET status='succeeded',billing_state='charged' WHERE id=?",
			)
			.bind(first.row.id)
			.run();
		expect(await usage(db, "owner", policy, now)).toMatchObject({
			used: 0,
			active: 0,
			retained: 1,
			remaining: 10,
		});
		expect(
			await usage(db, "owner", policy, Date.parse("2026-09-30T23:59:59Z")),
		).toMatchObject({ used: 1, reserved: 0 });
	});
	it("marks stale dispatch uncertain without releasing credit or offering blind fal retry", async () => {
		const stale = await reserve(makeInput(), now - 120001);
		await recoverStaleDispatch(db, "owner", now);
		const row = await ownedJob(db, "owner", stale.row.id);
		expect(row).toMatchObject({ status: "unknown", billing_state: "reserved" });
		expect(publicJob(row)).toMatchObject({
			canRefresh: false,
			canDelete: false,
			assetUrl: null,
		});
		expect((await usage(db, "owner", policy, now)).reserved).toBe(1);
	});
	it("does not confuse same keys or asset ownership across accounts", async () => {
		const input = makeInput();
		const result = await reserve(input);
		await expect(ownedJob(db, "other", result.row.id)).rejects.toMatchObject({
			status: 404,
		});
		expect(
			await existingRequest(db, "other", input, await requestHash(input)),
		).toBeNull();
	});
	it("does not grant paid generation policy from checkout/session/redirect alone", async () => {
		await grant();
		expect(await generationPolicy(env, "owner", now)).toMatchObject({
			plan: "free",
			limit: 10,
		});
	});
	it("does not grant paid policy from receipt or expired payment evidence", async () => {
		await grant({ effect: "receipt" });
		await grant({ effect: "grant", periodEnd: now });
		expect(await generationPolicy(env, "owner", now)).toMatchObject({
			plan: "free",
			limit: 10,
		});
	});
	it("takes paid policy only while ledger entitlement is current and recalculates after expiry", async () => {
		await grant({ effect: "grant", periodEnd: now + 1 });
		expect(await generationPolicy(env, "owner", now)).toMatchObject({
			plan: "pro",
			limit: 200,
		});
		expect(await generationPolicy(env, "owner", now + 1)).toMatchObject({
			plan: "free",
			limit: 10,
		});
	});
	it("enforces the lower current limit after paid access expires without erasing existing use", async () => {
		await grant({ effect: "grant", periodEnd: now });
		for (let index = 0; index < 11; index++) {
			const result = await reserve(makeInput(), now, { ...policy, limit: 200 });
			await db
				.prepare(
					"UPDATE generation_jobs SET status='succeeded',billing_state='charged' WHERE id=?",
				)
				.bind(result.row.id)
				.run();
		}
		const current = await generationPolicy(env, "owner", now);
		expect(current.plan).toBe("free");
		expect(await usage(db, "owner", current, now)).toMatchObject({
			used: 11,
			remaining: 0,
		});
		const next = makeInput();
		await expect(
			reserveJob(db, "owner", next, await requestHash(next), current, now),
		).rejects.toMatchObject({ status: 429 });
	});
	it("does not refund quota on downgrade and does not grant revoked entitlement", async () => {
		await grant({ effect: "revoke", state: "refunded" }, "one_time");
		expect(await generationPolicy(env, "owner", now)).toMatchObject({
			plan: "free",
		});
	});
	it("never advertises unconfigured providers as runnable", () => {
		expect(modelCatalog(env).every((model) => !model.available)).toBe(true);
		const placeholder = {
			...env,
			IMAGE_GENERATION_ENABLED: "true",
			FAL_API_KEY: "replace-me-token",
			CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
			CLOUDFLARE_AI_API_TOKEN: "your_token_example",
		};
		expect(modelCatalog(placeholder).every((model) => !model.available)).toBe(
			true,
		);
	});
	it("blocks deletion with active or uncertain jobs then removes its temporary freeze", async () => {
		const active = await reserve();
		await expect(prepareAccountDeletion(env, "owner")).rejects.toMatchObject({
			status: "BAD_REQUEST",
		});
		expect(
			await db
				.prepare("SELECT * FROM account_deletions WHERE user_id=?")
				.bind("owner")
				.first(),
		).toBeNull();
		await db
			.prepare("UPDATE generation_jobs SET status='unknown' WHERE id=?")
			.bind(active.row.id)
			.run();
		await expect(prepareAccountDeletion(env, "owner")).rejects.toMatchObject({
			status: "BAD_REQUEST",
		});
	});
	it("manifests generation objects before account deletion and removes them afterward", async () => {
		const complete = await reserve();
		await db
			.prepare(
				"UPDATE generation_jobs SET status='succeeded',billing_state='charged' WHERE id=?",
			)
			.bind(complete.row.id)
			.run();
		await prepareAccountDeletion(env, "owner");
		expect(await finishAccountDeletion(env, "owner")).toBe("not-deleted");
		expect(deletedObjects).toEqual([]);
		await expect(reserve()).rejects.toMatchObject({ status: 409 });
		await db.prepare("DELETE FROM user WHERE id=?").bind("owner").run();
		expect(await finishAccountDeletion(env, "owner")).toBe("complete");
		expect(deletedObjects).toEqual([complete.row.object_key]);
		expect(await finishAccountDeletion(env, "owner")).toBe("complete");
	});
});

Object.assign(websiteConfig.ai, {
	...DEFAULT_AI_POLICY,
	enabled: true,
	userConcurrent: 2,
	userDailyUnits: 400,
});
