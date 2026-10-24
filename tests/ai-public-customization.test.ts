import { describe, expect, it, vi } from "vitest";
import { createAiService } from "../src/ai/index.server";
import { aiModelKey, AI_MODEL_UNITS as policyWeights } from "../src/ai/policy";
import {
	AI_DEFAULT_MODELS,
	AI_PROVIDER_MODELS,
	AI_MODEL_UNITS,
} from "../src/config/ai-models";
import {
	AI_DEFAULT_MODELS as legacyDefaults,
	AI_MODEL_UNITS as legacyWeights,
} from "../src/ai/models";
import { CLEF_QUESTIONS } from "../src/lib/clef";
import { CLEF_QUESTIONS as legacyQuestions } from "../src/ai/clef.server";
vi.mock("@tanstack/react-start/server-only", () => ({}));

// Model real deployment edits at the documented public owners, not internal files.
vi.mock("../src/config/ai-models", async (original) => {
	const config = await original<typeof import("../src/config/ai-models")>();
	return {
		...config,
		AI_DEFAULT_MODELS: { ...config.AI_DEFAULT_MODELS, searchProvider: "exa" },
		AI_PROVIDER_MODELS: {
			...config.AI_PROVIDER_MODELS,
			textAndCaption: "@cf/fixture/reviewed-text",
		},
		AI_MODEL_UNITS: { ...config.AI_MODEL_UNITS, "web-search:exa": 7 },
	};
});
vi.mock("../src/lib/clef", async (original) => {
	const config = await original<typeof import("../src/lib/clef")>();
	return {
		...config,
		CLEF_QUESTIONS: {
			...config.CLEF_QUESTIONS,
			urgent: {
				...config.CLEF_QUESTIONS.urgent,
				instructions: "Custom deployment triage question",
			},
		},
	};
});
const config = {
	cloudflare: { accountId: "a".repeat(32), apiToken: "local-fixture-only" },
};

describe("documented AI customization files drive real execution", () => {
	it("makes legacy imports and policy refer to public configuration without copied defaults", () => {
		expect(legacyDefaults).toBe(AI_DEFAULT_MODELS);
		expect(legacyWeights).toBe(AI_MODEL_UNITS);
		expect(policyWeights).toBe(AI_MODEL_UNITS);
		expect(legacyQuestions).toBe(CLEF_QUESTIONS);
		expect(aiModelKey({ task: "web-search" })).toBe("web-search:exa");
		expect(policyWeights[aiModelKey({ task: "web-search" })]).toBe(7);
	});
	it("sends the default provider edited in config/ai-models through the actual service adapter", async () => {
		const transport = vi.fn(async (_url: string, _init?: RequestInit) =>
			Response.json({ items: [] }),
		);
		await createAiService(config, transport).webSearch({
			query: "fixture search",
		});
		expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toMatchObject({
			provider: "exa",
			limit: 5,
		});
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("uses the provider model ID edited in config/ai-models in the real request URL", async () => {
		const transport = vi.fn(async (_url: string, _init?: RequestInit) =>
			Response.json({ result: { response: "fixture summary" } }),
		);
		await createAiService(config, transport).summarize(
			"A local fixture source long enough for ordinary summary validation.",
		);
		expect(transport.mock.calls[0][0]).toContain(
			`/run/${AI_PROVIDER_MODELS.textAndCaption}`,
		);
		expect(transport.mock.calls[0][0]).toContain(
			"/run/@cf/fixture/reviewed-text",
		);
	});
	it("sends questions edited in lib/clef through the actual decision adapter", async () => {
		const transport = vi.fn(async (_url: string, _init?: RequestInit) =>
			Response.json({ result: {} }),
		);
		await expect(
			createAiService(config, transport).decide({
				text: "Every checkout is failing",
			}),
		).rejects.toThrow();
		const payload = JSON.parse(String(transport.mock.calls[0][1]?.body));
		expect(payload.questions).toEqual(CLEF_QUESTIONS);
		expect(payload.questions.urgent.instructions).toBe(
			"Custom deployment triage question",
		);
		expect(transport).toHaveBeenCalledTimes(1);
	});
});
