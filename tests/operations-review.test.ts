import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { logDiagnostic } from "../src/lib/diagnostics";
import { errorResponse, HttpError } from "../src/lib/security";
import { pruneRateLimits, rateLimit } from "../src/api/rate-limit.server";
import {
	drainAccountDeletions,
	finishAccountDeletion,
} from "../src/auth/deletion.server";
import { readiness } from "../src/api/readiness.server";
import { runMaintenance } from "../src/maintenance.server";
import { websiteConfig } from "../src/config/website";
import type { Bindings } from "../src/env";
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("../src/api/runtime.server", () => ({
	stringEnv: (env: Record<string, unknown>) =>
		Object.fromEntries(
			Object.entries(env).filter(([, value]) => typeof value === "string"),
		),
}));
afterEach(() => vi.restoreAllMocks());
describe("safe operational diagnostics", () => {
	it("logs only allowlisted structured values and correlates safe HTTP failures", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const id = "12345678-1234-1234-1234-123456789abc";
		const error = Object.assign(
			new Error("secret query password/token with email"),
			{ code: "UPSTREAM", status: 502, token: "do-not-log" },
		);
		logDiagnostic(error, {
			operation: "payment.webhook",
			provider: "stripe",
			eventId: "evt_fixture",
			requestId: id,
			durationMs: 2.3,
		});
		expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
			event: "operation_failed",
			operation: "payment.webhook",
			provider: "stripe",
			eventId: "evt_fixture",
			requestId: id,
			durationMs: 2,
			code: "UPSTREAM",
			upstreamStatus: 502,
		});
		const response = errorResponse(new HttpError(400, "Invalid field."), {
			requestId: id,
			operation: "api.request",
		});
		expect(response.headers.get("x-request-id")).toBe(id);
		expect(await response.json()).toEqual({
			error: "Invalid field.",
			code: "HTTP_ERROR",
			requestId: id,
		});
		expect(JSON.stringify(log.mock.calls)).not.toMatch(
			/secret query|do-not-log|password\/token/,
		);
	});
	it("drops arbitrary code, URLs and untrusted IDs instead of serializing them", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(
			logDiagnostic(
				{ code: "secret-value", message: "secret-value", status: 999 },
				{
					operation: "https://secret",
					provider: "secret-value",
					eventId: "a/b?token=secret",
					requestId: "secret",
					durationMs: Infinity,
				},
			),
		).toEqual({
			event: "operation_failed",
			operation: "request",
			code: "INTERNAL_ERROR",
		});
	});
});
describe("bounded local D1 operations", () => {
	let mf: Miniflare;
	let db: D1Database;
	let env: Bindings;
	let deleted: string[];
	beforeAll(async () => {
		mf = new Miniflare(
			convertV4MiniflareOptions({
				modules: true,
				script: 'export default {fetch(){return new Response("fixture")}}',
				compatibilityDate: "2026-10-01",
				d1Databases: ["DB"],
			}),
		);
		db = (await mf.getD1Database("DB")) as unknown as D1Database;
		const dir = fileURLToPath(new URL("../drizzle", import.meta.url));
		for (const name of (await readdir(dir))
			.filter((n) => n.endsWith(".sql"))
			.sort())
			for (const sql of (await readFile(`${dir}/${name}`, "utf8"))
				.split("--> statement-breakpoint")
				.map((s) => s.trim())
				.filter(Boolean))
				await db.prepare(sql).run();
	});
	beforeEach(async () => {
		await db.batch(
			[
				"DELETE FROM account_deletions",
				"DELETE FROM rate_limit",
				"DELETE FROM user",
			].map((sql) => db.prepare(sql)),
		);
		deleted = [];
		env = {
			DB: db,
			BUCKET: {
				delete: vi.fn(async (key: string) => {
					deleted.push(key);
				}),
			} as unknown as R2Bucket,
			CACHE: {} as KVNamespace,
			APP_ENV: "test",
			APP_URL: "http://localhost:3000",
			BETTER_AUTH_SECRET: "local-test-only-readiness-fixed-credential-12345",
		};
	});
	afterAll(async () => mf.dispose());
	it("drains more than ten objects in bounded resumable batches", async () => {
		await db
			.prepare(
				"INSERT INTO account_deletions(user_id,file_keys,created_at) VALUES(?,?,?)",
			)
			.bind(
				"deleted-fixture",
				JSON.stringify(Array.from({ length: 23 }, (_, i) => `fixture/${i}`)),
				1,
			)
			.run();
		expect(await drainAccountDeletions(env, 1000)).toEqual({
			attempted: 1,
			completed: 0,
			pending: 1,
		});
		expect(deleted).toHaveLength(10);
		expect(await drainAccountDeletions(env, 1500)).toEqual({
			attempted: 0,
			completed: 0,
			pending: 0,
		});
		await drainAccountDeletions(env, 2000);
		expect(deleted).toHaveLength(20);
		expect(await drainAccountDeletions(env, 3000)).toEqual({
			attempted: 1,
			completed: 1,
			pending: 0,
		});
		expect(new Set(deleted).size).toBe(23);
		expect(
			await db.prepare("SELECT count(*) n FROM account_deletions").first("n"),
		).toBe(0);
	});
	it("respects leases, living owners, and incomplete preparation", async () => {
		await db
			.prepare(
				"INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,1,1)",
			)
			.bind("owner", "Fixture", "owner@example.invalid")
			.run();
		await db.batch([
			db
				.prepare(
					"INSERT INTO account_deletions(user_id,file_keys,created_at,lease_until) VALUES(?,?,1,?)",
				)
				.bind("leased", '["fixture/key"]', 2000),
			db
				.prepare(
					"INSERT INTO account_deletions(user_id,file_keys,created_at) VALUES(?,?,1)",
				)
				.bind("owner", '["fixture/owned"]'),
			db
				.prepare(
					"INSERT INTO account_deletions(user_id,file_keys,created_at) VALUES(?,NULL,1)",
				)
				.bind("unfinished"),
		]);
		expect(await finishAccountDeletion(env, "owner", 1000)).toBe("not-deleted");
		expect(await finishAccountDeletion(env, "leased", 1000)).toBe("pending");
		expect(await drainAccountDeletions(env, 1000)).toEqual({
			attempted: 0,
			completed: 0,
			pending: 0,
		});
		expect(deleted).toEqual([]);
	});
	it("checkpoints partial cleanup and applies retry backoff without leaking errors", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const remove = vi.mocked(env.BUCKET.delete);
		remove
			.mockImplementationOnce(async () => {})
			.mockRejectedValueOnce(new Error("private-object-provider-detail"));
		await db
			.prepare(
				"INSERT INTO account_deletions(user_id,file_keys,created_at) VALUES(?,?,1)",
			)
			.bind("partial", '["fixture/1","fixture/2","fixture/3"]')
			.run();
		expect(await finishAccountDeletion(env, "partial", 1000)).toBe("pending");
		const row = await db
			.prepare(
				"SELECT file_keys,attempts,next_attempt_at,last_error_code,lease_until FROM account_deletions",
			)
			.first();
		expect(row).toMatchObject({
			file_keys: '["fixture/2","fixture/3"]',
			attempts: 1,
			next_attempt_at: 61000,
			last_error_code: "STORAGE_CLEANUP_FAILED",
			lease_until: 0,
		});
		expect(await drainAccountDeletions(env, 60000)).toEqual({
			attempted: 0,
			completed: 0,
			pending: 0,
		});
		expect((await drainAccountDeletions(env, 61000)).completed).toBe(1);
	});
	it("bounds indexed limiter pruning and never deletes Better Auth quota rows", async () => {
		const now = 200000000;
		await db.batch(
			Array.from({ length: 110 }, (_, i) =>
				db
					.prepare(
						"INSERT INTO rate_limit(id,key,count,last_request) VALUES(?,?,1,1)",
					)
					.bind(`api-${i}`, `api:fixture:${i}`),
			).concat([
				db.prepare(
					"INSERT INTO rate_limit(id,key,count,last_request) VALUES('auth','auth-fixture',1,1)",
				),
			]),
		);
		expect(await pruneRateLimits(db, now, 100)).toEqual({
			deleted: 100,
			ok: true,
		});
		expect(
			await db.prepare("SELECT count(*) n FROM rate_limit").first("n"),
		).toBe(11);
		const plan = await db
			.prepare(
				"EXPLAIN QUERY PLAN SELECT id FROM rate_limit INDEXED BY rate_limit_api_expiry_idx WHERE key GLOB 'api:*' AND last_request<? ORDER BY last_request,id LIMIT ?",
			)
			.bind(now - 86400000, 100)
			.all<{ detail: string }>();
		expect(JSON.stringify(plan.results)).toContain("rate_limit_api_expiry_idx");
		await rateLimit(db, "ordinary", 2, 60);
		await rateLimit(db, "ordinary", 2, 60);
		await expect(rateLimit(db, "ordinary", 2, 60)).rejects.toMatchObject({
			status: 429,
		});
	});
	it("does not make maintenance GC a business-request dependency", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const broken = {
			prepare: () => {
				throw Error("private database detail");
			},
		} as unknown as D1Database;
		expect(await pruneRateLimits(broken)).toEqual({ deleted: 0, ok: false });
		expect(await runMaintenance(env)).toEqual({ enabled: false });
		expect(deleted).toEqual([]);
	});

	it("uses the partial projection migration index when checking legacy payment rows", async () => {
		const plan = await db
			.prepare(
				"EXPLAIN QUERY PLAN SELECT reference FROM payment_checkouts WHERE user_id=? AND snapshot IS NULL LIMIT 1",
			)
			.bind("fixture-user")
			.all<{ detail: string }>();
		expect(JSON.stringify(plan.results)).toContain(
			"payment_missing_projection_idx",
		);
	});

	it("enabled maintenance drains only explicitly queued fixture manifests", async () => {
		env.MAINTENANCE_ENABLED = "true";
		await db
			.prepare(
				"INSERT INTO account_deletions(user_id,file_keys,created_at) VALUES(?,?,1)",
			)
			.bind("scheduled-fixture", '["fixture/scheduled"]')
			.run();
		const result = await runMaintenance(env, 1000);
		expect(result).toMatchObject({
			enabled: true,
			cleanup: { attempted: 1, completed: 1, pending: 0 },
			limiter: { ok: true },
			ai: { expired: 0, removed: 0 },
		});
		expect(deleted).toEqual(["fixture/scheduled"]);
	});
	it("readiness verifies schema and configured services without touching providers", async () => {
		const originalNewsletter = websiteConfig.newsletter.enable;
		websiteConfig.newsletter.enable = true;
		try {
		const network = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("No transport permitted"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await readiness(env);
		expect(result.status).toBe("not_ready");
		expect(result.checks).toMatchObject({
			database: true,
			migrations: true,
			authConfiguration: true,
			mailConfiguration: false,
			newsletterConfiguration: false,
			aiPolicy: true,
		});
		expect(result.features.aiEnabled).toBe(false);
		expect(network).not.toHaveBeenCalled();
		env.GOOGLE_CLIENT_ID = "fixture-google-id";
		env.GOOGLE_CLIENT_SECRET = "fixture-google-secret";
		env.CLOUDFLARE_EMAIL_API_TOKEN = "fixture-not-real";
		env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
		env.MAIL_FROM_EMAIL = "sender@example.invalid";
		env.RESEND_API_KEY = "fixture-not-real";
		env.RESEND_AUDIENCE_ID = "fixture";
		const enabled = await readiness(env);
		expect(enabled.status).toBe("ready");
		expect(network).not.toHaveBeenCalled();
		expect(JSON.stringify(enabled)).not.toContain("fixture-not-real");
		expect(websiteConfig.ai.enabled).toBe(false);
		} finally { websiteConfig.newsletter.enable = originalNewsletter; }
	});
});
