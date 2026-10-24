import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_TOOL_CARDS } from "../src/components/ai/cards";
import type { AiCardValues } from "../src/components/ai/card-contract";
import { AI_CARDS, type AiService } from "../src/ai/types";
import { aiTextConstraints } from "../src/ai/navigation";
import { aiTaskSchema, runAiTask } from "../src/ai/tasks/index.server";
import { getLocale, overwriteGetLocale } from "../src/locale/paraglide/runtime";
vi.mock("@tanstack/react-start/server-only", () => ({}));
const originalLocale = getLocale;
afterEach(() => overwriteGetLocale(originalLocale));
const values: AiCardValues = {
	text: "A local fixture source long enough for ordinary summary validation.",
	image: "data:image/png;base64,iVBORw0KGgoAAA==",
	option: "",
	source: "en",
	target: "zh",
};
const methods = {
	"web-search": "webSearch",
	decision: "decide",
	summarize: "summarize",
	translate: "translate",
	taglines: "taglines",
	speech: "speak",
	caption: "caption",
	"workers-image": "generateWorkersImage",
	"fal-image": "generateFalImage",
	avatar: "editAvatar",
} as const;
function service() {
	return {
		webSearch: vi.fn(async () => ({ items: [] })),
		decide: vi.fn(async () => ({ answers: {} })),
		summarize: vi.fn(async () => "summary"),
		translate: vi.fn(async () => "translation"),
		taglines: vi.fn(async () => ["one", "two", "three", "four", "five"]),
		speak: vi.fn(async () => ({
			bytes: new Uint8Array([1, 2, 3]),
			contentType: "audio/mpeg",
		})),
		caption: vi.fn(async () => "caption"),
		generateWorkersImage: vi.fn(async () => ({ images: [] })),
		generateFalImage: vi.fn(async () => ({ images: [] })),
		editAvatar: vi.fn(async () => ({ images: [] })),
	};
}

describe("ten independently editable AI tool cards and handlers", () => {
	it("registers exactly the ten advertised tools, with distinct field components", () => {
		expect(Object.keys(AI_TOOL_CARDS).sort()).toEqual(
			AI_CARDS.map(({ id }) => id).sort(),
		);
		expect(
			new Set(Object.values(AI_TOOL_CARDS).map((card) => card.Fields)).size,
		).toBe(10);
	});
	it.each(AI_CARDS.map(({ id }) => id))(
		"%s card serializes to its validated handler and executes only its own operation",
		async (task) => {
			const input = aiTaskSchema.parse(
				AI_TOOL_CARDS[task].buildRequest(values),
			);
			expect(input.task).toBe(task);
			const ai = service();
			const response = await runAiTask(ai as unknown as AiService, input);
			expect(response.status).toBe(200);
			expect(ai[methods[task]]).toHaveBeenCalledTimes(1);
			for (const [method, mock] of Object.entries(ai))
				if (method !== methods[task]) expect(mock).not.toHaveBeenCalled();
			if (task === "speech") {
				expect(response.headers.get("content-type")).toBe("audio/mpeg");
				expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
					1, 2, 3,
				]);
			} else {
				expect(response.headers.get("content-type")).toContain(
					"application/json",
				);
				expect(await response.json()).toBeTruthy();
			}
		},
	);
	it.each(AI_CARDS.map(({ id }) => id))(
		"%s fields preserve effective input limits in SSR",
		(task) => {
			const card = AI_TOOL_CARDS[task];
			const html = renderToStaticMarkup(
				createElement(card.Fields, {
					values,
					onChange() {},
					onError() {},
					snapshot: () => () => true,
				}),
			);
			const limits = aiTextConstraints(task);
			expect(html).toContain(`minLength="${limits.minLength}"`);
			expect(html).toContain(`maxLength="${limits.maxLength}"`);
			expect(html).toContain("<textarea");
			if (card.needsImage) expect(html).toContain('type="file"');
			else expect(html).not.toContain('type="file"');
			expect(html).not.toContain('type="submit"');
		},
	);
	it.each(["en", "zh"] as const)(
		"keeps each existing %s preset local to a card and schema-valid",
		(locale) => {
			overwriteGetLocale(() => locale);
			for (const card of Object.values(AI_TOOL_CARDS)) {
				expect(card.title()).toBeTruthy();
				for (const preset of card.presets) {
					expect(preset.label()).toBeTruthy();
					expect(() =>
						aiTaskSchema.parse(
							card.buildRequest({ ...values, text: preset.text() }),
						),
					).not.toThrow();
				}
			}
		},
	);
	it.each(["en", "zh"] as const)(
		"includes all documented example categories as executable %s presets",
		(locale) => {
			overwriteGetLocale(() => locale);
			const expected =
				locale === "en"
					? {
							"web-search": [
								"Travel planning",
								"English learning",
								"Dinner ideas",
							],
							caption: [
								"Short caption",
								"Detailed description",
								"Extract keywords",
							],
							avatar: ["Bobblehead", "Pixar 3D", "Anime portrait"],
						}
					: {
							"web-search": ["旅行规划", "英语学习", "晚餐灵感"],
							caption: ["简短图注", "详细描述", "提取关键词"],
							avatar: ["摇头公仔", "皮克斯风格 3D", "动漫肖像"],
						};
			for (const task of ["web-search", "caption", "avatar"] as const) {
				const card = AI_TOOL_CARDS[task];
				for (const label of expected[task]) {
					const preset = card.presets.find(
						(candidate) => candidate.label() === label,
					);
					expect(preset, `${task}: ${label}`).toBeDefined();
					const text = preset?.text() ?? "";
					expect(text.length).toBeGreaterThan(10);
					const body = aiTaskSchema.parse(
						card.buildRequest({ ...values, text }),
					);
					expect(body.task).toBe(task);
					expect(
						"query" in body
							? body.query
							: "prompt" in body
								? body.prompt
								: undefined,
					).toBe(text);
				}
			}
		},
	);

	it("keeps translation controls and voice/model choices in the owning cards", () => {
		const fields = (task: keyof typeof AI_TOOL_CARDS) =>
			renderToStaticMarkup(
				createElement(AI_TOOL_CARDS[task].Fields, {
					values,
					onChange() {},
					onError() {},
					snapshot: () => () => true,
				}),
			);
		expect(fields("translate")).toContain("Swap languages");
		expect(fields("speech")).toContain("asteria");
		expect(fields("web-search")).toContain("ceramic");
		expect(fields("workers-image")).toContain("flux-2-klein-4b");
		expect(fields("fal-image")).toContain("gpt-image-2");
	});
	it("keeps untrusted source links, markup, and malformed image outputs out of rendered cards", () => {
		const search = renderToStaticMarkup(
			createElement(AI_TOOL_CARDS["web-search"].Result, {
				audio: "",
				result: {
					items: [
						{
							url: "javascript:alert(1)",
							title: "unsafe",
							description: "unsafe",
						},
						{
							url: "https://example.test",
							title: "<script>text</script>",
							description: "fixture",
						},
					],
				},
			}),
		);
		expect(search).not.toContain("javascript:");
		expect(search).not.toContain("<script>");
		expect(search).toContain("&lt;script&gt;");
		const images = renderToStaticMarkup(
			createElement(AI_TOOL_CARDS["fal-image"].Result, {
				audio: "",
				result: {
					images: [
						null,
						{ url: "javascript:alert(1)" },
						{ url: "https://user:password@example.test/secret" },
						{ url: "data:image/svg+xml,unsafe" },
						{ url: "https://example.test/image.png" },
					],
				},
			}),
		);
		expect(images).toContain("https://example.test/image.png");
		expect(images).not.toMatch(/javascript|password|svg\+xml|secret/);
	});
	it("keeps every task handler server-only and every card free of direct provider/network dispatch", () => {
		for (const { id } of AI_CARDS) {
			const source = readFileSync(
				new URL(`../src/ai/tasks/${id}.server.ts`, import.meta.url),
				"utf8",
			);
			expect(source).toContain("@tanstack/react-start/server-only");
			expect(source).toContain("z.object(");
		}
		for (const slug of [
			"web-search",
			"decision",
			"summarization",
			"translation",
			"tagline",
			"tts",
			"caption",
			"cf-image",
			"image",
			"image-edit",
		]) {
			const source = readFileSync(
				new URL(`../src/components/ai/ai-${slug}-card.tsx`, import.meta.url),
				"utf8",
			);
			expect(source).toContain("buildRequest:");
			expect(source).not.toMatch(/fetch\(|createAiService|\.server["']/);
		}
	});
});
