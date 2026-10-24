import { generateImage, type ImageGenerationResult } from "@tanstack/ai";
import {
	falImage,
	FalImageAdapter,
	type FalClientConfig,
	type FalModel,
} from "@tanstack/ai-fal";
import {
	requestBytes,
	requiredConfig,
	ServiceError,
	type FetchTransport,
} from "./http.server";
import type { FalImageModel, ImageResult } from "./types";
import { AI_PROVIDER_MODELS } from "../config/ai-models";

/**
 * ai-fal currently configures a singleton. Recreate it immediately before
 * generateImages synchronously captures its client, not before TanStack's async
 * middleware boundary. Concurrent calls then keep their own credentials/fetch.
 * Regression-tested against the installed TanStack AI/fal v1 packages.
 */
class RequestScopedFalImage<T extends FalModel> extends FalImageAdapter<T> {
	constructor(
		model: T,
		private readonly requestConfig: FalClientConfig,
	) {
		super(model, requestConfig);
	}
	override generateImages(
		options: Parameters<FalImageAdapter<T>["generateImages"]>[0],
	): Promise<ImageGenerationResult> {
		return falImage(this.model, this.requestConfig).generateImages(options);
	}
}

export type AiProviderJobCallback = (job: {
	requestId: string;
	model: string;
}) => Promise<void>;

function sdkFetch(
	transport: FetchTransport,
	deadline: AbortSignal,
	onProviderJob?: AiProviderJobCallback,
): typeof fetch {
	return async (input, init) => {
		const url = new URL(
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url,
		);
		const method = (init?.method ?? "GET").toUpperCase();
		// No arbitrary storage uploads, user URLs, redirects, or queue cancellation.
		// Queue result IDs are untrusted: ensure they cannot change the path/origin.
		const allowed =
			/^\/(?:fal-ai\/(?:flux(?:\/schnell)?|nano-banana(?:\/edit)?)|openai\/gpt-image-2)(?:\/requests\/[A-Za-z0-9_-]+(?:\/status)?)?$/;
		if (
			url.origin !== "https://queue.fal.run" ||
			url.username ||
			url.password ||
			url.hash ||
			!allowed.test(url.pathname) ||
			!["GET", "POST"].includes(method) ||
			[...url.searchParams].some(
				([key, value]) => key !== "logs" || !["0", "1"].includes(value),
			)
		) {
			throw new ServiceError(
				"UPSTREAM",
				"fal attempted an unsupported API request",
			);
		}
		const signal = init?.signal
			? AbortSignal.any([deadline, init.signal])
			: deadline;
		// Throw our sanitized non-retryable error before the SDK converts failures
		// to ApiError (which its queue client would automatically retry).
		const result = await requestBytes(transport, url.href, {
			method: method as "GET" | "POST",
			headers: Object.fromEntries(new Headers(init?.headers)),
			body: init?.body ?? undefined,
			signal,
			timeoutMs: 120_000,
			maxResponseBytes: 20 * 1024 * 1024,
		});
		if (method === "POST" && onProviderJob) {
			const submission = JSON.parse(new TextDecoder().decode(result.bytes)) as {
				request_id?: unknown;
			};
			if (
				typeof submission.request_id !== "string" ||
				!/^[A-Za-z0-9_-]{1,128}$/.test(submission.request_id)
			)
				throw new ServiceError(
					"UPSTREAM",
					"fal returned an invalid job reference",
				);
			// Persist before polling. A persistence failure stops orchestration without
			// re-submitting a job whose paid outcome may already be in progress.
			await onProviderJob({
				requestId: submission.request_id,
				model: url.pathname.slice(1),
			});
		}
		return new Response(new Uint8Array(result.bytes), {
			headers: result.headers,
		});
	};
}
function output(result: ImageGenerationResult): ImageResult {
	if (!result.images.length || result.images.length > 1)
		throw new ServiceError(
			"UPSTREAM",
			"Image provider returned an unexpected image count",
		);
	return {
		images: result.images.map((image) => {
			if (typeof image.url !== "string")
				throw new ServiceError(
					"UPSTREAM",
					"fal returned an unsupported image representation",
				);
			const url = new URL(image.url);
			if (url.protocol !== "https:" || url.username || url.password)
				throw new ServiceError(
					"UPSTREAM",
					"Image provider returned an invalid image URL",
				);
			// The TanStack adapter normalizes away content_type. All selected calls
			// explicitly request PNG, including Flux Schnell, instead of guessing MIME.
			return { url: url.href, contentType: "image/png" };
		}),
	};
}
export async function generateFalImage(
	input: { prompt: string; model: FalImageModel; image?: string },
	apiKey: string | undefined,
	transport: FetchTransport,
	onProviderJob?: AiProviderJobCallback,
): Promise<ImageResult> {
	const key = requiredConfig(apiKey, "FAL_API_KEY (FAL_KEY alias supported)");
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 120_000);
	const config = {
		apiKey: key,
		fetch: sdkFetch(transport, controller.signal, onProviderJob),
	};
	const common = {
		prompt: input.prompt,
		threadId: crypto.randomUUID(),
		numberOfImages: 1,
		abortSignal: controller.signal,
		debug: false as const,
	};
	try {
		// Registry literals preserve each installed adapter's model-option inference.
		const result = input.image
			? await generateImage({
					...common,
					adapter: new RequestScopedFalImage(AI_PROVIDER_MODELS.avatar, config),
					size: "1:1",
					modelOptions: {
						image_urls: [input.image],
						output_format: "png",
						limit_generations: true,
					},
				})
			: input.model === "nano-banana"
				? await generateImage({
						...common,
						adapter: new RequestScopedFalImage(
							AI_PROVIDER_MODELS.falImage["nano-banana"],
							config,
						),
						size: "1:1",
						modelOptions: { output_format: "png" },
					})
				: input.model === "gpt-image-2"
					? await generateImage({
							...common,
							adapter: new RequestScopedFalImage(
								AI_PROVIDER_MODELS.falImage["gpt-image-2"],
								config,
							),
							size: "square_hd",
							modelOptions: { quality: "medium", output_format: "png" },
						})
					: await generateImage({
							...common,
							adapter: new RequestScopedFalImage(
								AI_PROVIDER_MODELS.falImage["flux-schnell"],
								config,
							),
							size: "square_hd",
							modelOptions: {
								enable_safety_checker: true,
								output_format: "png",
							},
						});
		return output(result);
	} catch (error) {
		if (controller.signal.aborted)
			throw new ServiceError(
				"TIMEOUT",
				"Image generation timed out. Its outcome is unknown; do not automatically retry.",
			);
		if (error instanceof ServiceError) throw error;
		throw new ServiceError(
			"UPSTREAM",
			"Image generation failed. Its outcome may be unknown; do not automatically retry.",
		);
	} finally {
		clearTimeout(timer);
	}
}
