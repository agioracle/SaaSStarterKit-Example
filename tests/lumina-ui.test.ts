import { describe, expect, it } from "vitest";
import {
	productEnglish,
	productChinese,
	productMessages,
} from "../src/components/lumina/messages";
import { l } from "../src/components/lumina/copy";
import {
	clearPendingRequest,
	pendingRequestKey,
	readPendingRequest,
	savePendingRequest,
} from "../src/components/lumina/pending-request";
import type { GenerationInput } from "../src/generation/types";
const input: GenerationInput = {
	model: "fal-flux-schnell",
	prompt: "A quiet still life",
	aspectRatio: "4:3",
	seed: 24,
	idempotencyKey: "12345678-1234-4234-8234-123456789012",
};
function storage() {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
		removeItem: (key: string) => {
			data.delete(key);
		},
	};
}
describe("Lumina centralized product copy", () => {
	it("has complete English and Chinese parity without empty strings", () => {
		expect(Object.keys(productEnglish).sort()).toEqual(
			Object.keys(productChinese).sort(),
		);
		expect(Object.keys(productEnglish).length).toBeGreaterThan(200);
		for (const catalog of Object.values(productMessages))
			for (const value of Object.values(catalog))
				expect(value.trim().length).toBeGreaterThan(0);
	});
	it("resolves explicit locales without mutating shared state", () => {
		expect(l("my_library", "en")).toBe("My library");
		expect(l("my_library", "zh")).toBe("我的作品库");
		expect(l("my_library", "en")).toBe("My library");
	});
	it("labels showcase illustrations honestly", () => {
		expect(
			Object.values(productEnglish).some((text) =>
				/not an AI-generated image/.test(text),
			),
		).toBe(true);
		expect(
			Object.values(productEnglish).some((text) =>
				/example prices, not an active offer/.test(text),
			),
		).toBe(true);
	});
});
describe("interrupted generation recovery", () => {
	it("persists the exact validated request and idempotency key before dispatch", () => {
		const target = storage();
		savePendingRequest(target, "owner-a", input);
		expect(readPendingRequest(target, "owner-a")).toEqual(input);
	});
	it("never restores another account’s pending prompt", () => {
		const target = storage();
		savePendingRequest(target, "owner-a", input);
		expect(readPendingRequest(target, "owner-b")).toBeNull();
	});
	it("rejects a mismatched owner envelope rather than dispatching it", () => {
		const target = storage();
		target.setItem(
			pendingRequestKey("owner-b"),
			JSON.stringify({ userId: "owner-a", input }),
		);
		expect(() => readPendingRequest(target, "owner-b")).toThrow();
	});
	it("clears only the confirmed account request", () => {
		const target = storage();
		savePendingRequest(target, "owner-a", input);
		savePendingRequest(target, "owner-b", input);
		clearPendingRequest(target, "owner-a");
		expect(readPendingRequest(target, "owner-a")).toBeNull();
		expect(readPendingRequest(target, "owner-b")).toEqual(input);
	});
	it("rejects corrupted or unsupported payloads", () => {
		const target = storage();
		target.setItem(pendingRequestKey("owner-a"), "{invalid");
		expect(() => readPendingRequest(target, "owner-a")).toThrow();
		expect(() =>
			savePendingRequest(target, "owner-a", {
				...input,
				model: "workers-flux-schnell",
			}),
		).toThrow();
	});
	it("does not hide a storage write failure", () => {
		expect(() =>
			savePendingRequest(
				{
					setItem: () => {
						throw new Error("denied");
					},
				},
				"owner-a",
				input,
			),
		).toThrow("denied");
	});
	it("requires an actual UUID recovery key", () => {
		expect(() =>
			savePendingRequest(storage(), "owner-a", {
				...input,
				idempotencyKey: "reused",
			}),
		).toThrow();
	});
});
