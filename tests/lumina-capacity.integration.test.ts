import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
	beforeAll,
	beforeEach,
	afterAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { websiteConfig } from "../src/config/website";
import { DEFAULT_AI_POLICY } from "../src/ai/policy";
import { reserveAiUsage, markAiDispatched } from "../src/ai/usage.server";
import { modelCatalog } from "../src/generation/policy.server";
import {
	reserveJob,
	requestHash,
	pruneGenerationCapacity,
} from "../src/generation/store.server";
import type { GenerationInput } from "../src/generation/types";
vi.mock("@tanstack/react-start/server-only", () => ({}));
const now = Date.parse("2026-10-24T10:00:00Z");
const policy = {
	plan: "free" as const,
	limit: 200,
	retainedLimit: 500,
	concurrencyLimit: 2,
};
const input = (): GenerationInput => ({
	model: "fal-flux-schnell",
	prompt: "Synthetic fixture",
	aspectRatio: "1:1",
	idempotencyKey: crypto.randomUUID(),
});
async function migrations(db: D1Database, names: string[]) {
	for (const name of names)
		for (const sql of (await readFile(`drizzle/${name}`, "utf8"))
			.split("--> statement-breakpoint")
			.filter((s) => s.trim()))
			await db.prepare(sql).run();
}
describe("Lumina shares template safety limits without double billing or deletion resets", () => {
	let mf: Miniflare;
	let db: D1Database;
	let names: string[];
	beforeAll(async () => {
		mf = new Miniflare(
			convertV4MiniflareOptions({
				modules: true,
				script: 'export default {fetch(){return new Response("fixture")}}',
				d1Databases: ["DB", "UPGRADE"],
				compatibilityDate: "2026-10-01",
			}),
		);
		db = (await mf.getD1Database("DB")) as unknown as D1Database;
		names = (await readdir("drizzle")).filter((n) => n.endsWith(".sql")).sort();
		await migrations(db, names);
	}, 30_000);
	beforeEach(async () => {
		Object.assign(websiteConfig.ai, DEFAULT_AI_POLICY, {
			enabled: true,
			userConcurrent: 2,
		});
		await db
			.prepare("UPDATE generation_jobs SET billing_state='released'")
			.run();
		await db.prepare("DELETE FROM user").run();
		await db.prepare("DELETE FROM generation_capacity").run();
		await db.prepare("DELETE FROM ai_usage_requests").run();
		for (const id of ["a", "b", "c"])
			await db
				.prepare(
					"INSERT INTO user(id,name,email,created_at,updated_at) VALUES(?,?,?,?,?)",
				)
				.bind(id, id, `${id}@example.invalid`, now, now)
				.run();
	});
	afterAll(async () => {
		Object.assign(websiteConfig.ai, DEFAULT_AI_POLICY);
		await mf?.dispose();
	});
	async function reserve(user = "a", value = input(), at = now) {
		return reserveJob(db, user, value, await requestHash(value), policy, at);
	}
	it("requires the template kill switch even with image switch and provider credentials", async () => {
		websiteConfig.ai.enabled = false;
		expect(
			modelCatalog({
				DB: db,
				BUCKET: {},
				IMAGE_GENERATION_ENABLED: "true",
				FAL_API_KEY: "fixture-no-network",
			} as never).every((m) => !m.available),
		).toBe(true);
		await expect(reserve()).rejects.toMatchObject({ status: 503 });
		expect(
			await db
				.prepare("SELECT count(*) AS n FROM generation_capacity")
				.first("n"),
		).toBe(0);
	});
	it("atomically bounds simultaneous distinct users by global concurrency", async () => {
		websiteConfig.ai.globalConcurrent = 2;
		const results = await Promise.allSettled([
			reserve("a"),
			reserve("b"),
			reserve("c"),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
		expect(
			await db
				.prepare("SELECT count(*) AS n FROM generation_capacity WHERE active=1")
				.first("n"),
		).toBe(2);
	});
	it("one idempotency key creates one product reservation and one capacity record", async () => {
		const value = input();
		const results = await Promise.all(
			Array.from({ length: 10 }, () => reserve("a", value)),
		);
		expect(results.filter((r) => r.created)).toHaveLength(1);
		expect(
			await db
				.prepare("SELECT sum(units) AS n FROM generation_capacity")
				.first("n"),
		).toBe(4);
		expect(
			await db
				.prepare("SELECT count(*) AS n FROM ai_usage_requests")
				.first("n"),
		).toBe(0);
	});
	it("settled failures consume conservative daily safety capacity while releasing monthly credits", async () => {
		websiteConfig.ai.userDailyUnits = 4;
		const job = await reserve();
		await db
			.prepare(
				"UPDATE generation_jobs SET status='failed',billing_state='released' WHERE id=?",
			)
			.bind(job.row.id)
			.run();
		await expect(reserve()).rejects.toMatchObject({ status: 429 });
		expect(
			await db.prepare("SELECT active,units FROM generation_capacity").first(),
		).toEqual({ active: 0, units: 4 });
	});
	it("image and account deletion cannot reset the global daily safety budget", async () => {
		websiteConfig.ai.globalDailyUnits = 40;
		websiteConfig.ai.userDailyUnits = 40;
		websiteConfig.ai.globalDailyRequests = 20;
		websiteConfig.ai.userDailyRequests = 20;
		const job = await reserve();
		await db
			.prepare(
				"UPDATE generation_jobs SET billing_state='charged',status='succeeded' WHERE id=?",
			)
			.bind(job.row.id)
			.run();
		await db.prepare("DELETE FROM user WHERE id='a'").run();
		expect(
			await db
				.prepare("SELECT count(*) AS n FROM generation_capacity")
				.first("n"),
		).toBe(1);
		websiteConfig.ai.globalDailyRequests = 1;
		websiteConfig.ai.userDailyRequests = 1;
		await expect(reserve("b")).rejects.toMatchObject({ status: 429 });
	});
	it("counts prior template AI dispatches and never lease-expires unknown capacity", async () => {
		websiteConfig.ai.globalConcurrent = 1;
		websiteConfig.ai.userConcurrent = 1;
		const claimed = await reserveAiUsage(
			db,
			websiteConfig.ai,
			{
				userId: "c",
				requestId: "legacy-template-request",
				payload: {},
				modelKey: "fal-image:flux-schnell",
			},
			now - 86_400_000,
		);
		if (!claimed.acquired) throw Error("Fixture reservation failed");
		await markAiDispatched(db, claimed.reservation, now - 86_400_000);
		await expect(reserve("a")).rejects.toMatchObject({ status: 429 });
	});
	it("keeps unresolved jobs across UTC days and prunes only old settled capacity", async () => {
		const job = await reserve("a", input(), now - 40 * 86_400_000);
		await db
			.prepare("UPDATE generation_jobs SET status='unknown' WHERE id=?")
			.bind(job.row.id)
			.run();
		await pruneGenerationCapacity(db, 30, now);
		expect(
			await db
				.prepare("SELECT active FROM generation_capacity")
				.first("active"),
		).toBe(1);
		await expect(
			db.prepare("DELETE FROM user WHERE id='a'").run(),
		).rejects.toThrow();
		await db
			.prepare(
				"UPDATE generation_jobs SET billing_state='charged',status='failed' WHERE id=?",
			)
			.bind(job.row.id)
			.run();
		await pruneGenerationCapacity(db, 30, now);
		expect(
			await db
				.prepare("SELECT count(*) AS n FROM generation_capacity")
				.first("n"),
		).toBe(0);
	});
	it("upgrades the original Lumina schema without replacing jobs, request IDs or reservations", async () => {
		const upgrade = (await mf.getD1Database(
			"UPGRADE",
		)) as unknown as D1Database;
		await migrations(
			upgrade,
			names.filter(
				(n) => /^000[0-3]_/.test(n) || n === "0004_lumina_generations.sql",
			),
		);
		await upgrade
			.prepare(
				"INSERT INTO user(id,name,email,created_at,updated_at) VALUES('legacy','Fixture','legacy@example.invalid',?,?)",
			)
			.bind(now, now)
			.run();
		await upgrade
			.prepare(
				"INSERT INTO generation_jobs(id,user_id,idempotency_key,request_hash,model,provider,prompt,aspect_ratio,status,billing_state,period,provider_request_id,object_key,created_at,updated_at) VALUES('original','legacy','stable','hash','fal-flux-schnell','fal','Retained fixture','1:1','unknown','reserved','2026-10','original-provider-id','generations/fixture',?,?)",
			)
			.bind(now, now)
			.run();
		await migrations(
			upgrade,
			names.filter(
				(n) => !/^000[0-3]_/.test(n) && n !== "0004_lumina_generations.sql",
			),
		);
		expect(
			await upgrade
				.prepare(
					"SELECT prompt,provider_request_id,billing_state FROM generation_jobs WHERE id='original'",
				)
				.first(),
		).toEqual({
			prompt: "Retained fixture",
			provider_request_id: "original-provider-id",
			billing_state: "reserved",
		});
		expect(
			await upgrade
				.prepare(
					"SELECT units,active FROM generation_capacity WHERE job_id='original'",
				)
				.first(),
		).toEqual({ units: 4, active: 1 });
	});
});
