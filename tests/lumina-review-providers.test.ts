import { websiteConfig } from "../src/config/website";
import { DEFAULT_AI_POLICY } from "../src/ai/policy";
import { describe, expect, it, vi } from "vitest";
import type { Bindings } from "../src/env";
import {
	GenerationProviderError,
	pollFal,
	submitFal,
} from "../src/generation/providers.server";
import type { Transport } from "../src/generation/providers.server";
vi.mock("@tanstack/react-start/server-only", () => ({}));
const env = { FAL_API_KEY: "fixture-local-no-network" } as unknown as Bindings;
const body = (data: unknown) =>
	new Response(JSON.stringify(data), {
		headers: { "Content-Type": "application/json" },
	});
function completedThen(download: Response): Transport {
	return vi.fn(async (url: string) =>
		url.endsWith("/status")
			? body({ status: "COMPLETED" })
			: url.includes("/requests/")
				? body({
						has_nsfw_concepts: [false],
						images: [
							{
								url: "https://fal.media/files/fixture.jpg",
								width: 1024,
								height: 1024,
							},
						],
					})
				: download,
	);
}
describe("Lumina independent provider outcome classification", () => {
	it.each([400, 401, 403, 422, 429, 500])(
		"keeps completed generation reserved after image CDN HTTP %s",
		async (status) => {
			await expect(
				pollFal(
					env,
					"fixture-request",
					completedThen(new Response("download failed", { status })),
				),
			).rejects.toMatchObject({ definitive: false, code: "result_pending" });
		},
	);
	it("keeps polling errors uncertain even if a status endpoint rejects credentials", async () => {
		const transport: Transport = vi.fn(
			async () => new Response("unauthorized", { status: 401 }),
		);
		await expect(
			pollFal(env, "fixture-request", transport),
		).rejects.toMatchObject({ definitive: false, code: "result_pending" });
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("does not automatically retry a submission after lost acceptance response", async () => {
		const transport: Transport = vi.fn(async () => {
			throw new TypeError("lost response");
		});
		await expect(
			submitFal(
				env,
				{
					model: "fal-flux-schnell",
					prompt: "local fixture",
					aspectRatio: "1:1",
					idempotencyKey: crypto.randomUUID(),
				},
				transport,
			),
		).rejects.toThrow();
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("treats provider-declared safety block as definitive without downloading", async () => {
		const transport: Transport = vi.fn(async (url: string) =>
			url.endsWith("/status")
				? body({ status: "COMPLETED" })
				: body({ has_nsfw_concepts: [true], images: [] }),
		);
		await expect(
			pollFal(env, "fixture-request", transport),
		).rejects.toMatchObject({ definitive: true, code: "safety_blocked" });
		expect(transport).toHaveBeenCalledTimes(2);
	});
	it("requires declared safety outcome rather than silently accepting missing metadata", async () => {
		const transport: Transport = vi.fn(async (url: string) =>
			url.endsWith("/status")
				? body({ status: "COMPLETED" })
				: body({ images: [{ url: "https://fal.media/files/fixture.jpg" }] }),
		);
		await expect(
			pollFal(env, "fixture-request", transport),
		).rejects.toBeInstanceOf(GenerationProviderError);
		expect(transport).toHaveBeenCalledTimes(2);
	});
});

Object.assign(websiteConfig.ai, {
	...DEFAULT_AI_POLICY,
	enabled: true,
	userConcurrent: 2,
});
