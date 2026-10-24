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
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { dispatchAiTask, evaluateTicket, searchWeb } from "../src/api/ai";
import {
	normalizeWebSearchInput,
	validSearchResults,
	SEARCH_PROVIDERS,
} from "../src/lib/web-search";
import { CLEF_QUESTIONS, parseDecisionResult } from "../src/lib/clef";
import { websiteConfig } from "../src/config/website";
import { DEFAULT_AI_POLICY } from "../src/ai/policy";
import { getAiRequestState } from "../src/ai/usage.server";
import { HttpError } from "../src/lib/security";
const fixture = vi.hoisted(() => ({
	env: {} as Record<string, unknown>,
	signedIn: true,
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("../src/api/runtime.server", () => ({
	bindings: () => fixture.env,
	stringEnv: (env: Record<string, unknown>) =>
		Object.fromEntries(
			Object.entries(env).filter(([, value]) => typeof value === "string"),
		),
}));
vi.mock("../src/auth/index.server", () => ({
	createAuth: vi.fn(),
	requireUser: async () => {
		if (!fixture.signedIn) throw new HttpError(401, "Sign in required.");
		return {
			user: {
				id: "facade-user",
				email: "fixture@example.invalid",
				role: "user",
			},
			session: { id: "fixture-session" },
		};
	},
}));
const originalPolicy = { ...websiteConfig.ai };
const id = (number = 1) => `facade-request-${String(number).padStart(4, "0")}`;
function context(
	number = 1,
	options: {
		method?: string;
		origin?: string | null;
		incomingId?: string;
	} = {},
) {
	const headers = new Headers({
		cookie: "fixture-session-cookie",
		"content-type": "application/json",
	});
	if (options.origin !== null)
		headers.set("Origin", options.origin ?? "https://app.example");
	if (options.incomingId) headers.set("Idempotency-Key", options.incomingId);
	return {
		request: new Request("https://app.example/server-action", {
			method: options.method ?? "POST",
			headers,
		}),
		requestId: id(number),
	};
}

// Retain adapter/facade coverage through the template policy in this test harness.
// Lumina's real dispatcher returns 410, covered separately by lumina-review-dispatch.
vi.mock("../src/api/index.server", async () => {
 const { handleAi } = await import("../src/api/ai.server");
 const { requireUser } = await import("../src/auth/index.server");
 const { assertSameOrigin, errorResponse } = await import("../src/lib/security");
 return { handleApi: async (request: Request) => {
  try {
   assertSameOrigin(request, String(fixture.env.APP_URL));
   const session = await requireUser(request, fixture.env as never);
   return await handleAi(request, fixture.env as never, session.user.id);
  } catch (error) { return errorResponse(error); }
 } };
});
describe("retained template AI facade policy in an isolated test harness", () => {
	let mf: Miniflare;
	let db: D1Database;
	const transport = vi.fn<typeof fetch>();
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
		for (const sql of [
			`CREATE TABLE ai_usage_requests (user_key TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, model_key TEXT NOT NULL, day TEXT NOT NULL, units INTEGER NOT NULL, status TEXT NOT NULL, provider_job_id TEXT, provider_model TEXT, lease_until INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_key,request_id))`,
			`CREATE TABLE rate_limit(id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL, last_request INTEGER NOT NULL)`,
		])
			await db.prepare(sql).run();
		fixture.env = {
			DB: db,
			APP_URL: "https://app.example",
			APP_ENV: "test",
			CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
			CLOUDFLARE_AI_API_TOKEN: "local-fixture-only",
		};
	});
	beforeEach(async () => {
		Object.assign(websiteConfig.ai, DEFAULT_AI_POLICY);
		fixture.signedIn = true;
		transport.mockReset();
		transport.mockImplementation(async () => {
			throw new Error("Unexpected local transport invocation");
		});
		vi.stubGlobal("fetch", transport);
		await db.batch([
			db.prepare("DELETE FROM ai_usage_requests"),
			db.prepare("DELETE FROM rate_limit"),
		]);
	});
	afterEach(() => {
		Object.assign(websiteConfig.ai, originalPolicy);
		vi.unstubAllGlobals();
	});
	afterAll(async () => {
		await mf?.dispose();
	});
	it("rejects a GET-originated mutation and mismatched stable request IDs", async () => {
		expect(
			(await searchWeb({ query: "fixture" }, context(1, { method: "GET" })))
				.status,
		).toBe(405);
		expect(
			(await searchWeb({ query: "fixture" }, context(1, { incomingId: id(2) })))
				.status,
		).toBe(409);
		expect(transport).not.toHaveBeenCalled();
	});
	it.each([null, "https://foreign.example"])(
		"does not invent same-origin authorization when the actual Origin is %s",
		async (origin) => {
			websiteConfig.ai.enabled = true;
			expect(
				(await searchWeb({ query: "fixture" }, context(1, { origin }))).status,
			).toBe(403);
			expect(transport).not.toHaveBeenCalled();
		},
	);
	it("cannot bypass the shared session requirement", async () => {
		websiteConfig.ai.enabled = true;
		fixture.signedIn = false;
		expect(
			(await evaluateTicket({ text: "Every checkout is failing" }, context()))
				.status,
		).toBe(401);
		expect(transport).not.toHaveBeenCalled();
	});
	it("keeps the default kill switch despite valid operation names and credentials", async () => {
		const response = await searchWeb({ query: "fixture" }, context());
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			code: "AI_DISABLED",
			outcome: "not_started",
		});
		expect(transport).not.toHaveBeenCalled();
	});
	it("retains real 402 diagnostics, consumed capacity and no redispatch through the facade", async () => {
		Object.assign(websiteConfig.ai, { enabled: true, userDailyUnits: 2 });
		transport.mockResolvedValue(
			Response.json({ error: "private-provider-message" }, { status: 402 }),
		);
		const first = await searchWeb({ query: "fixture" }, context());
		expect(first.status).toBe(402);
		expect(await first.json()).toMatchObject({
			code: "UNKNOWN_OUTCOME",
			setupHint: "CHECK_AI_GATEWAY_FUNDING",
			outcome: "unknown",
			requestId: id(),
			retryable: false,
		});
		expect(await getAiRequestState(db, "facade-user", id())).toMatchObject({
			outcome: "unknown",
		});
		expect(await getAiRequestState(db, "another-user", id())).toBeNull();
		const duplicate = await searchWeb({ query: "fixture" }, context());
		expect(await duplicate.json()).toMatchObject({ code: "UNKNOWN_OUTCOME" });
		expect((await searchWeb({ query: "new fixture" }, context(2))).status).toBe(
			429,
		);
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("still enforces actual rate admission on repeated invalid requests", async () => {
		websiteConfig.ai.enabled = true;
		for (let number = 1; number <= 10; number++)
			expect((await searchWeb({ query: "" }, context(number))).status).toBe(
				400,
			);
		expect((await searchWeb({ query: "" }, context(11))).status).toBe(429);
		expect(transport).not.toHaveBeenCalled();
	});
	it("preserves binary speech output and request metadata without an RPC serializer", async () => {
		websiteConfig.ai.enabled = true;
		transport.mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "audio/mpeg" },
			}),
		);
		const response = await dispatchAiTask(
			{ task: "speech", text: "Fixture speech" },
			context(),
		);
		expect(response.headers.get("content-type")).toBe("audio/mpeg");
		expect(response.headers.get("X-AI-Request-Id")).toBe(id());
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
			1, 2, 3,
		]);
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("binds evaluateTicket to decision even if extra runtime data spoofs another task", async () => {
		websiteConfig.ai.enabled = true;
		transport.mockResolvedValue(Response.json({ result: {} }));
		await evaluateTicket(
			{ text: "Every checkout is failing", task: "speech" } as Parameters<
				typeof evaluateTicket
			>[0],
			context(),
		);
		expect(String(transport.mock.calls[0][0])).toContain(
			"/run/@cf/cloudflare/clef",
		);
		expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toMatchObject({
			model: "clef",
			state: "Every checkout is failing",
			questions: CLEF_QUESTIONS,
		});
	});
});

describe("public pure helper paths", () => {
	it("normalizes search inputs using the central providers without executing requests", () => {
		expect(SEARCH_PROVIDERS).toEqual(["ceramic", "exa", "linkup"]);
		expect(normalizeWebSearchInput({ query: "  fixture  " })).toEqual({
			query: "fixture",
			provider: "ceramic",
			limit: 5,
		});
		for (const value of [
			{ query: " " },
			{ query: "x", provider: "unknown" },
			{ query: "x", limit: 11 },
		])
			expect(() => normalizeWebSearchInput(value)).toThrow();
		expect(
			validSearchResults([
				{ url: "javascript:alert(1)", title: "bad", description: "bad" },
			]),
		).toEqual([]);
	});
	it("exposes the Clef rubric and validation, not a paid provider call", () => {
		expect(Object.keys(CLEF_QUESTIONS)).toEqual(["urgent", "team", "severity"]);
		expect(() => parseDecisionResult({}, "clef")).toThrow();
	});
});
