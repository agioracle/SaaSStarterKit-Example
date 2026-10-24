import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { handleAi } from "../src/api/ai.server";
import {
	DEFAULT_AI_POLICY,
	aiModelKey,
	aiPolicyIssue,
	type AiUsagePolicy,
} from "../src/ai/policy";
import {
	finishAiUsage,
	getAiRequestState,
	markAiDispatched,
	pruneAiUsage,
	recordAiProviderJob,
	reserveAiUsage,
	type AiReservation,
} from "../src/ai/usage.server";
import type { Bindings } from "../src/env";
import { apiError, errorMessage } from "../src/lib/api-client";
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
const NOW = Date.UTC(2026, 9, 24, 12);
const id = (n: number) => `ordinary-request-${String(n).padStart(4, "0")}`;
const policy = (overrides: Partial<AiUsagePolicy> = {}): AiUsagePolicy => ({
	...DEFAULT_AI_POLICY,
	enabled: true,
	...overrides,
});
const request = (
	requestId: string,
	task: Record<string, unknown> = {
		task: "summarize",
		text: "A local fixture source long enough for ordinary summary validation.",
	},
) =>
	new Request("https://local.test/api/ai", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"Idempotency-Key": requestId,
		},
		body: JSON.stringify(task),
	});
const response = (value: unknown) => Response.json(value);

describe("bounded AI usage on local D1 (no provider requests)", () => {
	let mf: Miniflare;
	let db: D1Database;
	let env: Bindings;
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
		// Isolated storage contract fixture, deliberately independent of unrelated
		// auth/payment migrations. The full Worker suite exercises those migrations.
		for (const sql of `CREATE TABLE ai_usage_requests (
			user_key TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
			model_key TEXT NOT NULL, day TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>0),
			status TEXT NOT NULL CHECK(status IN ('reserved','running','succeeded','released','unknown')),
			provider_job_id TEXT, provider_model TEXT, lease_until INTEGER NOT NULL,
			created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_key,request_id));
			CREATE INDEX ai_usage_day_idx ON ai_usage_requests(day,status,units);
			CREATE INDEX ai_usage_user_day_idx ON ai_usage_requests(user_key,day,status,units);
			CREATE INDEX ai_usage_lease_idx ON ai_usage_requests(status,lease_until);
			CREATE INDEX ai_usage_retention_idx ON ai_usage_requests(status,updated_at);
			CREATE TABLE rate_limit(id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL, last_request INTEGER NOT NULL);`
			.split(";")
			.map((part) => part.trim())
			.filter(Boolean))
			await db.prepare(sql).run();
		env = {
			DB: db,
			CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
			CLOUDFLARE_AI_API_TOKEN: "local-fixture-only",
			FAL_API_KEY: "local-fixture-only",
		} as unknown as Bindings;
	});
	beforeEach(async () => {
		await db.batch([
			db.prepare("DELETE FROM ai_usage_requests"),
			db.prepare("DELETE FROM rate_limit"),
		]);
	});
	afterAll(async () => {
		await mf?.dispose();
	});
	async function acquire(
		n: number,
		userId = "user-one",
		p = policy(),
		now = NOW,
		modelKey: "summarize" | "fal-image:gpt-image-2" = "summarize",
	) {
		const result = await reserveAiUsage(
			db,
			p,
			{
				userId,
				requestId: id(n),
				payload: { text: "fixture", modelKey },
				modelKey,
			},
			now,
		);
		if (!result.acquired) throw new Error("Expected a new reservation");
		return result.reservation;
	}
	async function succeed(reservation: AiReservation, now = NOW) {
		await markAiDispatched(db, reservation, now);
		await finishAiUsage(db, reservation, "succeeded", now + 1);
	}

	it("keeps provider spending disabled by default despite configured keys", async () => {
		const transport = vi.fn(async () =>
			response({ result: { response: "unused" } }),
		);
		const result = await handleAi(request(id(1)), env, "user-one", {
			policy: DEFAULT_AI_POLICY,
			transport,
		});
		expect(result.status).toBe(503);
		expect(await result.json()).toMatchObject({
			code: "AI_DISABLED",
			outcome: "not_started",
		});
		expect(transport).not.toHaveBeenCalled();
		expect(
			await db
				.prepare("SELECT COUNT(*) AS count FROM ai_usage_requests")
				.first("count"),
		).toBe(0);
	});
	it("requires a stable request ID before any paid dispatch", async () => {
		const req = request(id(1));
		req.headers.delete("Idempotency-Key");
		const transport = vi.fn();
		const result = await handleAi(req, env, "user-one", {
			policy: policy(),
			transport,
		});
		expect(result.status).toBe(400);
		expect(await result.json()).toMatchObject({
			code: "AI_REQUEST_ID_REQUIRED",
		});
		expect(transport).not.toHaveBeenCalled();
	});
	it.each([NaN, Infinity, 0, -1, 1.5, 10_001])(
		"rejects an unbounded/invalid daily limit %s",
		async (globalDailyRequests) => {
			const configured = policy({ globalDailyRequests });
			expect(aiPolicyIssue(configured)).toBeTruthy();
			await expect(acquire(1, "one", configured)).rejects.toMatchObject({
				code: "AI_POLICY_INVALID",
			});
		},
	);
	it("assigns fixed model weights and rejects missing model capacity", () => {
		expect(aiModelKey({ task: "fal-image" })).toBe("fal-image:flux-schnell");
		expect(aiModelKey({ task: "workers-image" })).toBe(
			"workers-image:flux-2-klein-4b",
		);
		expect(() => aiModelKey({ task: "future-model" })).toThrow();
	});
	it("atomically enforces user concurrency across simultaneous requests", async () => {
		const results = await Promise.allSettled(
			Array.from({ length: 8 }, (_, i) =>
				acquire(i, "same-user", policy({ userConcurrent: 2 })),
			),
		);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
		expect(results.filter((r) => r.status === "rejected")).toHaveLength(6);
	});
	it("atomically enforces global concurrency across different users", async () => {
		const results = await Promise.allSettled(
			Array.from({ length: 8 }, (_, i) =>
				acquire(i, `user-${i}`, policy({ globalConcurrent: 2 })),
			),
		);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
	});
	it("only grants one reservation for concurrent duplicate IDs", async () => {
		const results = await Promise.all(
			Array.from({ length: 8 }, () =>
				reserveAiUsage(
					db,
					policy(),
					{
						userId: "one",
						requestId: id(1),
						payload: { text: "same" },
						modelKey: "summarize",
					},
					NOW,
				),
			),
		);
		expect(results.filter((r) => r.acquired)).toHaveLength(1);
		expect(results.filter((r) => !r.acquired)).toHaveLength(7);
	});
	it("rejects key reuse with a changed payload, even after success", async () => {
		const reserved = await acquire(1);
		await succeed(reserved);
		await expect(
			reserveAiUsage(
				db,
				policy(),
				{
					userId: "user-one",
					requestId: id(1),
					payload: { text: "changed" },
					modelKey: "summarize",
				},
				NOW,
			),
		).rejects.toMatchObject({ code: "AI_REQUEST_CONFLICT" });
	});
	it("keeps completed calls charged against the per-user daily request budget", async () => {
		const configured = policy({ userDailyRequests: 2 });
		await succeed(await acquire(1, "one", configured));
		await succeed(await acquire(2, "one", configured));
		await expect(acquire(3, "one", configured)).rejects.toMatchObject({
			code: "AI_LIMIT_REACHED",
		});
		await expect(acquire(4, "another", configured)).resolves.toBeDefined();
	});
	it("atomically rejects weighted global budget overshoot across users", async () => {
		const configured = policy({ userDailyUnits: 12, globalDailyUnits: 12 });
		const results = await Promise.allSettled([
			acquire(1, "one", configured, NOW, "fal-image:gpt-image-2"),
			acquire(2, "two", configured, NOW, "fal-image:gpt-image-2"),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	});
	it("enforces weighted user budget independently from global budget", async () => {
		const configured = policy({ userDailyUnits: 12 });
		await succeed(
			await acquire(1, "one", configured, NOW, "fal-image:gpt-image-2"),
		);
		await expect(acquire(2, "one", configured)).rejects.toMatchObject({
			code: "AI_LIMIT_REACHED",
		});
		await expect(acquire(3, "two", configured)).resolves.toBeDefined();
	});
	it("does not refund an unknown outcome or permit redispatch after its lease", async () => {
		const configured = policy({ userDailyRequests: 1 });
		const reserved = await acquire(1, "one", configured);
		await markAiDispatched(db, reserved, NOW);
		await finishAiUsage(db, reserved, "unknown", NOW + 1);
		await expect(
			finishAiUsage(db, reserved, "released", NOW + 2),
		).rejects.toThrow();
		await expect(
			acquire(2, "one", configured, NOW + 200_000),
		).rejects.toMatchObject({ code: "AI_LIMIT_REACHED" });
		await expect(
			markAiDispatched(db, reserved, NOW + 200_000),
		).rejects.toThrow();
		expect(
			await getAiRequestState(db, "one", id(1), NOW + 200_000),
		).toMatchObject({ outcome: "unknown", retryable: false });
	});
	it("treats an expired running lease as unknown, not an invitation to retry", async () => {
		const reserved = await acquire(1);
		await markAiDispatched(db, reserved, NOW);
		expect(
			await getAiRequestState(db, "user-one", id(1), NOW + 200_000),
		).toMatchObject({ outcome: "unknown" });
		await expect(
			markAiDispatched(db, reserved, NOW + 200_000),
		).rejects.toThrow();
	});
	it("releases undispatched capacity but never reuses that request ID", async () => {
		const configured = policy({ userDailyRequests: 2, userDailyUnits: 1 });
		const reserved = await acquire(1, "one", configured);
		await finishAiUsage(db, reserved, "released", NOW);
		await expect(acquire(2, "one", configured)).resolves.toBeDefined();
		await expect(markAiDispatched(db, reserved, NOW)).rejects.toThrow();
	});
	it("safely expires undispatched leases without a cleanup race", async () => {
		const configured = policy({ userDailyRequests: 2, userDailyUnits: 1 });
		const reserved = await acquire(1, "one", configured);
		await expect(
			acquire(2, "one", configured, NOW + 200_000),
		).resolves.toBeDefined();
		await expect(
			markAiDispatched(db, reserved, NOW + 200_000),
		).rejects.toThrow();
		expect(
			await getAiRequestState(db, "one", id(1), NOW + 200_000),
		).toMatchObject({ outcome: "released" });
	});
	it("resets daily capacity at UTC midnight without forgetting idempotency or unknown outcomes", async () => {
		const configured = policy({ userDailyRequests: 1 });
		const reserved = await acquire(1, "one", configured);
		await markAiDispatched(db, reserved, NOW);
		await finishAiUsage(db, reserved, "unknown", NOW);
		await expect(
			acquire(2, "one", configured, NOW + 86_400_000),
		).resolves.toBeDefined();
		expect(
			await getAiRequestState(db, "one", id(1), NOW + 86_400_000),
		).toMatchObject({ outcome: "unknown" });
	});
	it("persists sanitized provider job references with owner-scoped status", async () => {
		const reserved = await acquire(1);
		await markAiDispatched(db, reserved, NOW);
		await recordAiProviderJob(
			db,
			reserved,
			{ requestId: "fal-fixture-job", model: "fal-ai/flux/schnell" },
			NOW,
		);
		expect(await getAiRequestState(db, "user-one", id(1), NOW)).toMatchObject({
			providerJobId: "fal-fixture-job",
			providerModel: "fal-ai/flux/schnell",
		});
		expect(await getAiRequestState(db, "other-user", id(1), NOW)).toBeNull();
	});
	it("returns structured unknown and does not resubmit the duplicate after a lost response", async () => {
		const transport = vi.fn(async () => {
			throw new Error("ordinary network interruption");
		});
		const first = await handleAi(request(id(1)), env, "one", {
			policy: policy(),
			transport,
		});
		expect(first.status).toBe(502);
		expect(await first.json()).toMatchObject({
			code: "UNKNOWN_OUTCOME",
			outcome: "unknown",
			requestId: id(1),
			retryable: false,
		});
		const second = await handleAi(request(id(1)), env, "one", {
			policy: policy(),
			transport,
		});
		expect(await second.json()).toMatchObject({
			code: "UNKNOWN_OUTCOME",
			outcome: "unknown",
		});
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it.each([
		[
			{ task: "web-search", query: "local fixture" },
			"CHECK_AI_GATEWAY_FUNDING",
			2,
		],
		[
			{
				task: "summarize",
				text: "A local fixture source long enough for ordinary summary validation.",
			},
			"CHECK_WORKERS_AI_BILLING",
			1,
		],
		[
			{ task: "fal-image", prompt: "A small paper boat" },
			"CHECK_FAL_BILLING",
			4,
		],
	] as const)(
		"preserves actionable 402 diagnostics without refund or retry for %j",
		async (task, setupHint, units) => {
			const configured = policy({ userDailyUnits: units });
			const transport = vi.fn(async () =>
				Response.json(
					{
						error: "private-provider-token-and-prompt",
						setupHint: "https://malicious.invalid/?secret=fixture",
					},
					{ status: 402 },
				),
			);
			const first = await handleAi(request(id(1), task), env, "one", {
				policy: configured,
				transport,
			});
			expect(first.status).toBe(402);
			expect(first.headers.get("X-AI-Request-Id")).toBe(id(1));
			expect(first.headers.get("X-AI-Outcome")).toBe("unknown");
			const serialized = await first.clone().text();
			expect(serialized).not.toMatch(/private-provider|malicious|secret/);
			expect(await first.clone().json()).toMatchObject({
				code: "UNKNOWN_OUTCOME",
				outcome: "unknown",
				requestId: id(1),
				retryable: false,
				providerCode: "PAYMENT_REQUIRED",
				setupHint,
			});
			const clientFailure = await apiError(first);
			expect(errorMessage(clientFailure)).toContain(id(1));
			expect(errorMessage(clientFailure)).toContain("billing");
			expect(await getAiRequestState(db, "one", id(1))).toMatchObject({
				outcome: "unknown",
				retryable: false,
			});
			expect(await getAiRequestState(db, "someone-else", id(1))).toBeNull();
			await expect(
				acquire(2, "one", configured, Date.now()),
			).rejects.toMatchObject({ code: "AI_LIMIT_REACHED" });
			const duplicate = await handleAi(request(id(1), task), env, "one", {
				policy: configured,
				transport,
			});
			expect(await duplicate.json()).toMatchObject({
				code: "UNKNOWN_OUTCOME",
				outcome: "unknown",
				retryable: false,
			});
			expect(transport).toHaveBeenCalledTimes(1);
			const row = await db
				.prepare(
					"SELECT status, units FROM ai_usage_requests WHERE request_id=?",
				)
				.bind(id(1))
				.first();
			expect(row).toEqual({ status: "unknown", units });
		},
	);
	it("retains fal job references when a 402 is encountered during read-only polling", async () => {
		const transport = vi.fn(async (_url: string, init?: RequestInit) =>
			init?.method === "POST"
				? response({ request_id: "billing-check-job" })
				: Response.json({ error: "private-provider-message" }, { status: 402 }),
		);
		const first = await handleAi(
			request(id(1), { task: "fal-image", prompt: "A small paper boat" }),
			env,
			"one",
			{ policy: policy(), transport },
		);
		expect(first.status).toBe(402);
		expect(await first.json()).toMatchObject({
			outcome: "unknown",
			providerJobId: "billing-check-job",
			setupHint: "CHECK_FAL_BILLING",
			retryable: false,
		});
		expect(await getAiRequestState(db, "one", id(1))).toMatchObject({
			outcome: "unknown",
			providerJobId: "billing-check-job",
		});
		expect(
			transport.mock.calls.filter(([, init]) => init?.method === "POST"),
		).toHaveLength(1);
	});
	it("does not infer funding guidance from arbitrary upstream failure text", async () => {
		const transport = vi.fn(async () =>
			Response.json(
				{ error: "402 add credits secret-provider-token" },
				{ status: 500 },
			),
		);
		const first = await handleAi(request(id(1)), env, "one", {
			policy: policy(),
			transport,
		});
		expect(first.status).toBe(502);
		const body = (await first.json()) as Record<string, unknown>;
		expect(body).toMatchObject({ code: "UNKNOWN_OUTCOME", outcome: "unknown" });
		expect(body).not.toHaveProperty("providerCode");
		expect(body).not.toHaveProperty("setupHint");
		expect(JSON.stringify(body)).not.toContain("secret-provider-token");
	});

	it("returns successful data once and completed-duplicate state without another call", async () => {
		const transport = vi.fn(async () =>
			response({ result: { response: "fixture summary" } }),
		);
		const first = await handleAi(request(id(1)), env, "one", {
			policy: policy(),
			transport,
		});
		expect(await first.json()).toEqual({ text: "fixture summary" });
		expect(first.headers.get("X-AI-Request-Id")).toBe(id(1));
		const second = await handleAi(request(id(1)), env, "one", {
			policy: policy(),
			transport,
		});
		expect(await second.json()).toMatchObject({
			code: "AI_ALREADY_COMPLETED",
			outcome: "succeeded",
		});
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("releases pre-dispatch configuration failures without retaining capacity", async () => {
		const transport = vi.fn();
		const result = await handleAi(
			request(id(1)),
			{ DB: db } as Bindings,
			"one",
			{
				policy: policy({ userDailyRequests: 2, userDailyUnits: 1 }),
				transport,
			},
		);
		expect(await result.json()).toMatchObject({
			code: "AI_NOT_STARTED",
			outcome: "released",
			setupHint: "CHECK_AI_CONFIGURATION",
		});
		expect(transport).not.toHaveBeenCalled();
		await expect(
			acquire(
				2,
				"one",
				policy({ userDailyRequests: 2, userDailyUnits: 1 }),
				Date.now(),
			),
		).resolves.toBeDefined();
	});
	it("persists fal job ID before polling, even when its result is lost", async () => {
		const transport = vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.method === "POST")
				return response({ request_id: "fal-known-job" });
			throw new Error("ordinary polling interruption");
		});
		const result = await handleAi(
			request(id(1), { task: "fal-image", prompt: "A small paper boat" }),
			env,
			"one",
			{ policy: policy(), transport },
		);
		expect(await result.json()).toMatchObject({
			code: "UNKNOWN_OUTCOME",
			providerJobId: "fal-known-job",
		});
		expect(await getAiRequestState(db, "one", id(1))).toMatchObject({
			outcome: "unknown",
			providerJobId: "fal-known-job",
			providerModel: "fal-ai/flux/schnell",
		});
		expect(
			transport.mock.calls.filter(([, init]) => init?.method === "POST"),
		).toHaveLength(1);
	});
	it("allows a read-only status lookup while the global spend switch is off", async () => {
		const reserved = await acquire(1, "one", policy(), Date.now());
		await markAiDispatched(db, reserved);
		await finishAiUsage(db, reserved, "unknown");
		const transport = vi.fn();
		const result = await handleAi(
			new Request(`https://local.test/api/ai?requestId=${id(1)}`),
			env,
			"one",
			{ policy: DEFAULT_AI_POLICY, transport },
		);
		expect(await result.json()).toMatchObject({ outcome: "unknown" });
		expect(transport).not.toHaveBeenCalled();
	});
	it("bounds terminal pruning and preserves unknown jobs after the retention window", async () => {
		for (let n = 1; n <= 3; n++) await succeed(await acquire(n, `user-${n}`));
		const unknown = await acquire(4, "four");
		await markAiDispatched(db, unknown, NOW);
		await recordAiProviderJob(
			db,
			unknown,
			{ requestId: "keep-job", model: "fal-ai/flux/schnell" },
			NOW,
		);
		await finishAiUsage(db, unknown, "unknown", NOW);
		expect(await pruneAiUsage(db, 30, 2, NOW + 31 * 86_400_000)).toMatchObject({
			removed: 2,
		});
		expect(
			await getAiRequestState(db, "four", id(4), NOW + 31 * 86_400_000),
		).toMatchObject({ outcome: "unknown", providerJobId: "keep-job" });
		expect(
			await db
				.prepare("SELECT COUNT(*) AS count FROM ai_usage_requests")
				.first("count"),
		).toBe(2);
	});
	it("retains a full execution lease when dispatch starts near reservation expiry", async () => {
		const reserved = await acquire(1);
		await markAiDispatched(db, reserved, NOW + 170_000);
		await expect(
			acquire(2, "user-one", policy(), NOW + 200_000),
		).rejects.toMatchObject({ code: "AI_LIMIT_REACHED" });
		expect(
			await getAiRequestState(db, "user-one", id(1), NOW + 200_000),
		).toMatchObject({ outcome: "pending" });
	});
	it("counts released attempts toward request limits, bounding durable row growth", async () => {
		const configured = policy({ userDailyRequests: 1 });
		const reserved = await acquire(1, "one", configured);
		await finishAiUsage(db, reserved, "released", NOW);
		await expect(acquire(2, "one", configured)).rejects.toMatchObject({
			code: "AI_LIMIT_REACHED",
		});
	});
	it("does not dispatch when the durable running transition cannot be written", async () => {
		const failedDb = {
			prepare(sql: string) {
				if (sql.includes("SET status='running'"))
					throw new Error("ordinary local database failure");
				return db.prepare(sql);
			},
		} as D1Database;
		const transport = vi.fn();
		const result = await handleAi(
			request(id(1)),
			{ ...env, DB: failedDb },
			"one",
			{ policy: policy(), transport },
		);
		expect(await result.json()).toMatchObject({
			code: "AI_NOT_STARTED",
			outcome: "released",
		});
		expect(transport).not.toHaveBeenCalled();
	});
	it("preserves unknown when outcome persistence fails after dispatch", async () => {
		const failedDb = {
			prepare(sql: string) {
				if (sql.includes("SET status=?,updated_at=?"))
					throw new Error("ordinary local outcome storage failure");
				return db.prepare(sql);
			},
		} as D1Database;
		const transport = vi.fn(async () =>
			response({ result: { response: "completed externally" } }),
		);
		const result = await handleAi(
			request(id(1)),
			{ ...env, DB: failedDb },
			"one",
			{ policy: policy(), transport },
		);
		expect(await result.json()).toMatchObject({
			code: "UNKNOWN_OUTCOME",
			outcome: "unknown",
		});
		const second = await handleAi(request(id(1)), env, "one", {
			policy: policy(),
			transport,
		});
		expect(await second.json()).toMatchObject({ code: "AI_REQUEST_PENDING" });
		expect(transport).toHaveBeenCalledTimes(1);
		expect(
			await getAiRequestState(db, "one", id(1), Date.now() + 200_000),
		).toMatchObject({ outcome: "unknown" });
	});
	it("stops fal orchestration rather than resubmitting if its job cannot be persisted", async () => {
		const failedDb = {
			prepare(sql: string) {
				if (sql.includes("SET provider_job_id=?"))
					throw new Error("ordinary local job storage failure");
				return db.prepare(sql);
			},
		} as D1Database;
		const transport = vi.fn(async () =>
			response({ request_id: "known-but-not-persisted" }),
		);
		const result = await handleAi(
			request(id(1), { task: "fal-image", prompt: "A small paper boat" }),
			{ ...env, DB: failedDb },
			"one",
			{ policy: policy(), transport },
		);
		expect(await result.json()).toMatchObject({
			code: "UNKNOWN_OUTCOME",
			providerJobId: "known-but-not-persisted",
		});
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("returns not-started for ordinary input or admission failures before dispatch", async () => {
		const transport = vi.fn();
		const invalid = await handleAi(
			request(id(1), { task: "summarize", text: "short" }),
			env,
			"one",
			{ policy: policy(), transport },
		);
		expect(await invalid.json()).toMatchObject({
			code: "AI_INVALID_INPUT",
			outcome: "not_started",
			requestId: id(1),
		});
		const failedDb = {
			prepare() {
				throw new Error("ordinary local database unavailable");
			},
		} as unknown as D1Database;
		const unavailable = await handleAi(
			request(id(2)),
			{ ...env, DB: failedDb },
			"one",
			{ policy: policy(), transport },
		);
		expect(await unavailable.json()).toMatchObject({
			code: "AI_NOT_STARTED",
			outcome: "not_started",
			requestId: id(2),
		});
		expect(transport).not.toHaveBeenCalled();
	});
});
