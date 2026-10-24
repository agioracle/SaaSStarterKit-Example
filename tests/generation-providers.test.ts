import { websiteConfig } from "../src/config/website";
import { DEFAULT_AI_POLICY } from "../src/ai/policy";
import { describe, it, expect, vi } from "vitest";
import { modelCatalog } from "../src/generation/policy.server";
import { generationInputSchema, utcPeriod } from "../src/generation/validation";
import {
	generateWorkers,
	MAX_IMAGE_BYTES,
	pollFal,
	submitFal,
	validateImage,
} from "../src/generation/providers.server";
import type { Bindings } from "../src/env";
import type { GenerationInput } from "../src/generation/types";
vi.mock("@tanstack/react-start/server-only", () => ({}));
const input: GenerationInput = {
	model: "fal-flux-schnell",
	prompt: "A mountain",
	aspectRatio: "16:9",
	seed: 42,
	idempotencyKey: crypto.randomUUID(),
};
const env = {
	DB: {},
	BUCKET: {},
	IMAGE_GENERATION_ENABLED: "true",
	FAL_API_KEY: "local-fixture-fal-token",
	CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
	CLOUDFLARE_AI_API_TOKEN: "local-fixture-cf-token",
} as unknown as Bindings;
const jpg = new Uint8Array([
	255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 255, 217,
]);
describe("generation boundary contracts (local transports only)", () => {
	it("validates prompt, model-specific aspect/seed, strict options and UUID", () => {
		expect(
			generationInputSchema.parse({ ...input, prompt: "  mountain  " }).prompt,
		).toBe("mountain");
		for (const patch of [
			{ prompt: " " },
			{ prompt: "x".repeat(2001) },
			{ seed: -1 },
			{ seed: 2147483648 },
			{ seed: 1.5 },
			{ aspectRatio: "2:1" },
			{ model: "external" },
			{ idempotencyKey: "bad" },
			{ outputUrl: "https://evil.test" },
			{ model: "workers-flux-schnell", aspectRatio: "16:9" },
			{ model: "workers-flux-schnell", aspectRatio: "1:1", seed: 1 },
		])
			expect(
				generationInputSchema.safeParse({ ...input, ...patch }).success,
			).toBe(false);
		expect(
			generationInputSchema.safeParse({
				model: "workers-flux-schnell",
				prompt: "cat",
				aspectRatio: "1:1",
				idempotencyKey: crypto.randomUUID(),
			}).success,
		).toBe(true);
	});
	it("uses UTC month boundaries", () => {
		expect(utcPeriod(Date.parse("2026-10-01T00:00:00Z"))).toBe("2026-10");
		expect(utcPeriod(Date.parse("2026-09-30T23:59:59Z"))).toBe("2026-09");
	});
	it("fails closed for no flag or placeholder credentials", () => {
		expect(
			modelCatalog({ ...env, IMAGE_GENERATION_ENABLED: undefined }).every(
				(m) => !m.available,
			),
		).toBe(true);
		expect(
			modelCatalog({
				...env,
				FAL_API_KEY: "replace-me",
				CLOUDFLARE_AI_API_TOKEN: "your-token",
			}).every((m) => !m.available),
		).toBe(true);
		expect(modelCatalog(env).every((m) => m.available)).toBe(true);
	});
	it("submits fal queue once with supported settings and forced safety", async () => {
		const transport = vi.fn(async () =>
			Response.json({ request_id: "local-request" }),
		);
		await expect(submitFal(env, input, transport)).resolves.toBe(
			"local-request",
		);
		expect(transport).toHaveBeenCalledTimes(1);
		const [url, init] = transport.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://queue.fal.run/fal-ai/flux/schnell");
		expect(JSON.parse(String(init.body))).toEqual({
			prompt: "A mountain",
			image_size: "landscape_16_9",
			seed: 42,
			num_images: 1,
			num_inference_steps: 4,
			enable_safety_checker: true,
			output_format: "jpeg",
			sync_mode: false,
		});
		expect(init.redirect).toBe("error");
	});
	it("does not retry ambiguous submission or follow redirects", async () => {
		const transport = vi.fn(async () => {
			throw Error("network");
		});
		await expect(submitFal(env, input, transport)).rejects.toThrow();
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("calls Workers REST with only documented prompt and steps", async () => {
		const transport = vi.fn(async () =>
			Response.json({
				success: true,
				result: { image: Buffer.from(jpg).toString("base64") },
			}),
		);
		const result = await generateWorkers(
			env,
			{
				...input,
				model: "workers-flux-schnell",
				aspectRatio: "1:1",
				seed: undefined,
			},
			transport,
		);
		expect(result.bytes).toEqual(jpg);
		expect(result.contentType).toBe("image/jpeg");
		const [url, init] = transport.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toContain("/ai/run/@cf/black-forest-labs/flux-1-schnell");
		expect(JSON.parse(String(init.body))).toEqual({
			prompt: "A mountain",
			steps: 4,
		});
	});
	it("rejects invalid image MIME/magic and oversized output", () => {
		expect(() => validateImage(jpg, "image/svg+xml")).toThrow();
		expect(() => validateImage(new Uint8Array([0, 0]), "image/jpeg")).toThrow();
		expect(() =>
			validateImage(new Uint8Array(MAX_IMAGE_BYTES + 1), "image/png"),
		).toThrow();
	});
	it("never releases credits on status transport errors", async () => {
		await expect(
			pollFal(
				env,
				"local-request",
				async () => new Response("denied", { status: 403 }),
			),
		).rejects.toMatchObject({ definitive: false, code: "result_pending" });
	});
	it("fetches status via owner/app path and never follows external image URLs", async () => {
		const seen: string[] = [];
		const transport = async (url: string) => {
			seen.push(url);
			return Response.json(
				url.endsWith("/status")
					? { status: "COMPLETED" }
					: {
							has_nsfw_concepts: [false],
							images: [{ url: "https://evil.example/image.jpg" }],
						},
			);
		};
		await expect(
			pollFal(env, "local-request", transport),
		).rejects.toMatchObject({ definitive: false });
		expect(seen).toEqual([
			"https://queue.fal.run/fal-ai/flux/requests/local-request/status",
			"https://queue.fal.run/fal-ai/flux/requests/local-request",
		]);
	});
	it("blocks unsafe output before making any CDN request", async () => {
		const transport = vi.fn(async (url: string) =>
			Response.json(
				url.endsWith("/status")
					? { status: "COMPLETED" }
					: {
							has_nsfw_concepts: [true],
							images: [{ url: "https://v3.fal.media/x.jpg" }],
						},
			),
		);
		await expect(
			pollFal(env, "local-request", transport),
		).rejects.toMatchObject({ definitive: true, code: "safety_blocked" });
		expect(transport).toHaveBeenCalledTimes(2);
	});
});
describe("generation bounded transport deadline", () => {
	it("aborts an unresponsive submission without retrying", async () => {
		vi.useFakeTimers();
		try {
			let signal: AbortSignal | undefined | null;
			const transport = vi.fn(async (_url: string, init?: RequestInit) => {
				signal = init?.signal;
				return await new Promise<Response>(() => {});
			});
			const promise = submitFal(env, input, transport);
			const assertion = expect(promise).rejects.toMatchObject({
				definitive: false,
			});
			await vi.advanceTimersByTimeAsync(20001);
			await assertion;
			expect(signal?.aborted).toBe(true);
			expect(transport).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

Object.assign(websiteConfig.ai, {
	...DEFAULT_AI_POLICY,
	enabled: true,
	userConcurrent: 2,
});
