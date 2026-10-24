import { describe, expect, it, vi } from "vitest";
import * as publicModels from "../src/config/ai-models";
import * as catalogue from "../src/ai/types";
import {
	AI_DEFAULT_MODELS,
	AI_MODEL_UNITS,
	AI_PROVIDER_MODELS,
} from "../src/ai/models";
import { aiModelKey, AI_MODEL_UNITS as policyWeights } from "../src/ai/policy";
import { createAiService } from "../src/ai/index.server";
vi.mock("@tanstack/react-start/server-only", () => ({}));
const config = {
	cloudflare: { accountId: "a".repeat(32), apiToken: "local-fixture-only" },
};

describe("single client-safe AI model configuration", () => {
	it("exposes the same catalogue/default/weight objects through public and existing entries", () => {
		for (const [publicValue, existingValue] of [
			[publicModels.SEARCH_PROVIDERS, catalogue.SEARCH_PROVIDERS],
			[publicModels.DECISION_MODELS, catalogue.DECISION_MODELS],
			[publicModels.TRANSLATION_LANGUAGES, catalogue.TRANSLATION_LANGUAGES],
			[publicModels.SPEECH_VOICES, catalogue.SPEECH_VOICES],
			[publicModels.WORKERS_IMAGE_MODELS, catalogue.WORKERS_IMAGE_MODELS],
			[publicModels.FAL_IMAGE_MODELS, catalogue.FAL_IMAGE_MODELS],
		])
			expect(publicValue).toBe(existingValue);
		expect(publicModels.AI_DEFAULT_MODELS).toBe(AI_DEFAULT_MODELS);
		expect(publicModels.AI_PROVIDER_MODELS).toBe(AI_PROVIDER_MODELS);
		expect(policyWeights).toBe(AI_MODEL_UNITS);
	});
	it("keeps defaults admitted by the same server-side budget keys", () => {
		expect(aiModelKey({ task: "web-search" })).toBe(
			`web-search:${AI_DEFAULT_MODELS.searchProvider}`,
		);
		expect(aiModelKey({ task: "decision" })).toBe(
			`decision:${AI_DEFAULT_MODELS.decision}`,
		);
		expect(aiModelKey({ task: "workers-image" })).toBe(
			`workers-image:${AI_DEFAULT_MODELS.workersImage}`,
		);
		expect(aiModelKey({ task: "fal-image" })).toBe(
			`fal-image:${AI_DEFAULT_MODELS.falImage}`,
		);
	});
	it("requires a positive weight for every UI selector, with no orphaned multi-model weight", () => {
		const keys = [
			...catalogue.SEARCH_PROVIDERS.map((provider) =>
				aiModelKey({ task: "web-search", provider }),
			),
			...catalogue.DECISION_MODELS.map((model) =>
				aiModelKey({ task: "decision", model }),
			),
			...catalogue.WORKERS_IMAGE_MODELS.map((model) =>
				aiModelKey({ task: "workers-image", model }),
			),
			...catalogue.FAL_IMAGE_MODELS.map((model) =>
				aiModelKey({ task: "fal-image", model }),
			),
		];
		for (const key of keys) expect(AI_MODEL_UNITS[key]).toBeGreaterThan(0);
		expect(keys.sort()).toEqual(
			Object.keys(AI_MODEL_UNITS)
				.filter((key) => key.includes(":"))
				.sort(),
		);
	});
	it("keeps model IDs for every selectable provider model", () => {
		expect(Object.keys(AI_PROVIDER_MODELS.decision).sort()).toEqual(
			[...catalogue.DECISION_MODELS].sort(),
		);
		expect(Object.keys(AI_PROVIDER_MODELS.workersImage).sort()).toEqual(
			[...catalogue.WORKERS_IMAGE_MODELS].sort(),
		);
		expect(Object.keys(AI_PROVIDER_MODELS.falImage).sort()).toEqual(
			[...catalogue.FAL_IMAGE_MODELS].sort(),
		);
	});
	it("uses the registry's text model and search default in real adapter transport", async () => {
		const transport = vi.fn(async (url: string) =>
			url.includes("websearch")
				? Response.json({ items: [] })
				: Response.json({ result: { response: "fixture summary" } }),
		);
		const ai = createAiService(config, transport);
		await ai.summarize(
			"A local fixture source long enough for ordinary summary validation.",
		);
		expect(transport.mock.calls[0][0]).toContain(
			`/run/${AI_PROVIDER_MODELS.textAndCaption}`,
		);
		await ai.webSearch({ query: "local fixture" });
		const call = transport.mock.calls[1] as unknown as [string, RequestInit];
		expect(JSON.parse(String(call[1].body))).toMatchObject({
			provider: AI_DEFAULT_MODELS.searchProvider,
		});
	});
});
