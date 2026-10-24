import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, apiError, errorMessage } from "../src/lib/api-client";
import { getLocale, overwriteGetLocale } from "../src/locale/paraglide/runtime";
import { m } from "../src/locale/paraglide/messages";
const originalLocale = getLocale;
const requestId = "ordinary-request-reference-1234";
beforeEach(() => overwriteGetLocale(() => "en"));
afterEach(() => {
	overwriteGetLocale(originalLocale);
	vi.unstubAllGlobals();
});

describe("safe structured API diagnostics", () => {
	it("retains only bounded allowlisted public fields, never upstream messages or bodies", async () => {
		const failure = await apiError(
			Response.json(
				{
					error: "sk-private-fixture upstream message",
					message: "private customer payload",
					code: "UNKNOWN_OUTCOME",
					requestId,
					outcome: "unknown",
					providerCode: "PAYMENT_REQUIRED",
					setupHint: "CHECK_AI_GATEWAY_FUNDING",
					retryable: true,
					body: { apiKey: "secret-fixture" },
				},
				{ status: 402 },
			),
		);
		expect(failure).toMatchObject({
			status: 402,
			code: "UNKNOWN_OUTCOME",
			requestId,
			outcome: "unknown",
			providerCode: "PAYMENT_REQUIRED",
			setupHint: "CHECK_AI_GATEWAY_FUNDING",
			retryable: false,
		});
		expect(failure).not.toHaveProperty("body");
		expect(failure).not.toHaveProperty("cause");
		expect(JSON.stringify(failure)).not.toMatch(
			/sk-private|private customer|secret-fixture/,
		);
		expect(errorMessage(failure)).toContain("AI Gateway credits");
		expect(errorMessage(failure)).toContain("Do not resubmit");
		expect(errorMessage(failure)).toContain(requestId);
	});
	it("localizes the same diagnostic on formatting and includes the copyable reference once", () => {
		const failure = new ApiError(402, {
			requestId,
			code: "UNKNOWN_OUTCOME",
			outcome: "unknown",
			setupHint: "CHECK_AI_GATEWAY_FUNDING",
		});
		expect(errorMessage(failure)).toContain("Request reference:");
		overwriteGetLocale(() => "zh");
		const text = errorMessage(failure);
		expect(text).toContain("AI Gateway 余额");
		expect(text).toContain("请求编号");
		expect(text).toContain("不要");
		expect(text.split(requestId)).toHaveLength(2);
		expect(text).not.toContain("Request reference:");
	});
	it.each([
		null,
		[],
		"private response",
		{ error: { message: "private response" } },
	])("never renders an unrecognized response shape: %j", (body) => {
		const failure = new ApiError(503, body);
		expect(errorMessage(failure)).toBe(
			m.ai_diagnostic_request_failed({ status: 503 }),
		);
		expect(errorMessage(failure)).not.toContain("private response");
	});
	it("rejects injected diagnostics and unsafe request IDs while using a safe header reference", () => {
		const failure = new ApiError(
			502,
			{
				code: "SECRET_ABC",
				requestId: "<script>private</script>",
				outcome: "retry_safely",
				providerCode: "secret-token",
				setupHint: "Visit https://unsafe.example/?token=secret",
			},
			new Headers({ "X-Request-ID": requestId }),
		);
		expect(failure.requestId).toBe(requestId);
		for (const key of ["code", "outcome", "providerCode", "setupHint"] as const)
			expect(failure[key]).toBeUndefined();
		expect(JSON.stringify(failure)).not.toMatch(/script|SECRET|token|unsafe/);
	});
	it.each([
		"x",
		"a".repeat(129),
		"spaces are not allowed here",
		"a\nbcdefghijklmnop",
		"request@example.test",
	])("omits invalid request references: %j", (id) => {
		expect(new ApiError(500, { requestId: id }).requestId).toBeUndefined();
	});
	it("handles an HTML/proxy error without rendering it and preserves the locally saved AI reference", async () => {
		const failure = await apiError(
			new Response("<html>secret debug output</html>", { status: 502 }),
			requestId,
		);
		expect(failure.requestId).toBe(requestId);
		expect(errorMessage(failure)).not.toMatch(/html|secret|debug/);
	});
	it("keeps structured errors from the shared API helper with no retry", async () => {
		const fetch = vi.fn(async () =>
			Response.json(
				{
					error: {
						code: "CONFIGURATION",
						requestId,
						message: "private configuration",
					},
				},
				{ status: 503 },
			),
		);
		vi.stubGlobal("fetch", fetch);
		await expect(api("/api/fixture")).rejects.toMatchObject({
			status: 503,
			code: "CONFIGURATION",
			requestId,
		});
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("preserves Headers input and JSON success behavior", async () => {
		const fetch = vi.fn(async () => Response.json({ success: true }));
		vi.stubGlobal("fetch", fetch);
		await expect(
			api("/api/fixture", {
				method: "POST",
				body: "{}",
				headers: new Headers({ "X-Fixture": "yes" }),
			}),
		).resolves.toEqual({ success: true });
		const headers = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
			.headers as Headers;
		expect(headers.get("X-Fixture")).toBe("yes");
		expect(headers.get("Content-Type")).toBe("application/json");
	});
	it("does not mislabel pre-dispatch input validation as an account configuration problem", () => {
		const failure = new ApiError(400, {
			code: "AI_NOT_STARTED",
			outcome: "released",
			requestId,
		});
		expect(errorMessage(failure)).toContain(m.ai_diagnostic_invalid_input());
		expect(errorMessage(failure)).not.toContain("configuration");
	});

	it("provides provider-specific billing and non-secret configuration instructions", () => {
		expect(
			errorMessage(new ApiError(402, { setupHint: "CHECK_FAL_BILLING" })),
		).toContain("fal.ai account credits");
		expect(
			errorMessage(
				new ApiError(402, { setupHint: "CHECK_WORKERS_AI_BILLING" }),
			),
		).toContain("Workers AI account billing");
		expect(
			errorMessage(
				new ApiError(503, {
					code: "AI_NOT_STARTED",
					setupHint: "CHECK_AI_CONFIGURATION",
				}),
			),
		).toContain("Do not share secret keys");
	});
});
