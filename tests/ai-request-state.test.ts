import { describe, expect, it } from "vitest";
import {
	aiClientOutcome,
	readAiClientRequest,
	saveAiClientRequest,
} from "../src/ai/request-state";
function storage() {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
	};
}
const requestId = "opaque-request-reference-1234";
describe("AI request reference retention", () => {
	it("preserves the same ID across interrupted browser waits without retaining input", () => {
		const session = storage();
		saveAiClientRequest(session, "user-a", { requestId, outcome: "pending" });
		expect(readAiClientRequest(session, "user-a")).toEqual({
			requestId,
			outcome: "unknown",
		});
		expect([...session.values.values()]).toEqual([
			JSON.stringify({ requestId, outcome: "pending" }),
		]);
	});
	it("isolates the saved reference by signed-in user", () => {
		const session = storage();
		saveAiClientRequest(session, "user-a", { requestId, outcome: "unknown" });
		expect(readAiClientRequest(session, "user-b")).toBeNull();
	});
	it("keeps completed IDs until an explicit new request", () => {
		const session = storage();
		saveAiClientRequest(session, "user-a", { requestId, outcome: "succeeded" });
		expect(readAiClientRequest(session, "user-a")?.requestId).toBe(requestId);
		saveAiClientRequest(session, "user-a", null);
		expect(readAiClientRequest(session, "user-a")).toBeNull();
	});
	it("does not invent a successful or safely failed outcome from malformed data", () => {
		expect(aiClientOutcome("random-status")).toBe("unknown");
		expect(aiClientOutcome(undefined)).toBe("unknown");
		const session = storage();
		session.setItem(
			"edgekit.ai.request:user-a",
			JSON.stringify({ requestId: "invalid" }),
		);
		expect(() => readAiClientRequest(session, "user-a")).toThrow();
	});
	it("surfaces unavailable persistence instead of silently losing the stable ID", () => {
		const unavailable = {
			setItem() {
				throw new Error("Storage unavailable");
			},
			removeItem() {},
		};
		expect(() =>
			saveAiClientRequest(unavailable, "user-a", {
				requestId,
				outcome: "pending",
			}),
		).toThrow("Storage unavailable");
	});
});
