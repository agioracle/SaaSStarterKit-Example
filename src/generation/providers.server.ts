import "@tanstack/react-start/server-only";
import { AI_PROVIDER_MODELS } from "../config/ai-models";
import type { Bindings } from "../env";
import { validateMagicBytes } from "../storage";
import type { GenerationInput, AspectRatio } from "./types";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export type Transport = (url: string, init?: RequestInit) => Promise<Response>;
export interface ImageOutput {
	bytes: Uint8Array;
	contentType: "image/jpeg" | "image/png";
	width: number | null;
	height: number | null;
}
export class GenerationProviderError extends Error {
	constructor(
		public definitive = false,
		public code = "dispatch_uncertain",
	) {
		super("Image provider request failed.");
	}
}
const FAL_ROOT = "https://queue.fal.run/fal-ai/flux";
const SIZE: Record<AspectRatio, string> = {
	"1:1": "square_hd",
	"4:3": "landscape_4_3",
	"3:4": "portrait_4_3",
	"16:9": "landscape_16_9",
	"9:16": "portrait_16_9",
};
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new GenerationProviderError();
	return value as Record<string, unknown>;
}
/** Request + streamed body are under one abort deadline; never retries inference. */
async function responseBytes(
	transport: Transport,
	url: string,
	init: RequestInit,
	max: number,
	timeout = 20000,
) {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			(async () => {
				const response = await transport(url, {
					...init,
					redirect: "error",
					signal: controller.signal,
				});
				if (!response.ok) {
					await response.body?.cancel();
					throw new GenerationProviderError(
						[400, 401, 403, 422, 429].includes(response.status),
						"provider_rejected",
					);
				}
				const size = Number(response.headers.get("content-length") || "0");
				if (size > max) {
					await response.body?.cancel();
					throw new GenerationProviderError();
				}
				const reader = response.body?.getReader();
				if (!reader) throw new GenerationProviderError();
				const chunks: Uint8Array[] = [];
				let length = 0;
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					length += value.byteLength;
					if (length > max) {
						await reader.cancel();
						throw new GenerationProviderError();
					}
					chunks.push(value);
				}
				const bytes = new Uint8Array(length);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.byteLength;
				}
				return { response, bytes };
			})(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					controller.abort();
					reject(new GenerationProviderError());
				}, timeout);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
		controller.abort();
	}
}
async function json(
	transport: Transport,
	url: string,
	init: RequestInit,
	max = 1024 * 1024,
	timeout = 20000,
) {
	const { bytes } = await responseBytes(transport, url, init, max, timeout);
	try {
		return record(JSON.parse(new TextDecoder().decode(bytes)));
	} catch {
		throw new GenerationProviderError();
	}
}
function falHeaders(env: Bindings) {
	return {
		Authorization: `Key ${env.FAL_API_KEY}`,
		"Content-Type": "application/json",
	};
}
export async function submitFal(
	env: Bindings,
	input: GenerationInput,
	transport: Transport = fetch,
): Promise<string> {
	const data = await json(
		transport,
		`https://queue.fal.run/${AI_PROVIDER_MODELS.falImage["flux-schnell"]}`,
		{
			method: "POST",
			headers: { ...falHeaders(env), "X-Fal-Request-Start-Timeout": "120" },
			body: JSON.stringify({
				prompt: input.prompt,
				image_size: SIZE[input.aspectRatio],
				...(input.seed === undefined ? {} : { seed: input.seed }),
				num_images: 1,
				num_inference_steps: 4,
				enable_safety_checker: true,
				output_format: "jpeg",
				sync_mode: false,
			}),
		},
	);
	if (
		typeof data.request_id !== "string" ||
		!/^[A-Za-z0-9_-]{1,128}$/.test(data.request_id)
	)
		throw new GenerationProviderError();
	return data.request_id;
}
export type FalPoll =
	| { status: "queued" | "processing" }
	| { status: "succeeded"; image: ImageOutput };
export async function pollFal(
	env: Bindings,
	requestId: string,
	transport: Transport = fetch,
): Promise<FalPoll> {
	if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
		throw new GenerationProviderError();
	const url = `${FAL_ROOT}/requests/${requestId}`;
	let state: Record<string, unknown>;
	// Polling errors never prove the original generation failed or refund its reservation.
	try {
		state = await json(transport, `${url}/status`, {
			headers: falHeaders(env),
		});
	} catch {
		throw new GenerationProviderError(false, "result_pending");
	}
	if (state.status === "IN_QUEUE") return { status: "queued" };
	if (state.status === "IN_PROGRESS") return { status: "processing" };
	if (state.status !== "COMPLETED")
		throw new GenerationProviderError(false, "result_pending");
	if (state.error || state.error_type)
		throw new GenerationProviderError(true, "provider_failed");
	let result: Record<string, unknown>;
	try {
		result = await json(transport, url, { headers: falHeaders(env) });
	} catch {
		throw new GenerationProviderError(false, "result_pending");
	}
	if (
		!Array.isArray(result.has_nsfw_concepts) ||
		result.has_nsfw_concepts.length !== 1 ||
		typeof result.has_nsfw_concepts[0] !== "boolean"
	)
		throw new GenerationProviderError(false, "result_pending");
	if (result.has_nsfw_concepts[0])
		throw new GenerationProviderError(true, "safety_blocked");
	if (!Array.isArray(result.images) || result.images.length !== 1)
		throw new GenerationProviderError(false, "result_pending");
	const image = record(result.images[0]);
	if (typeof image.url !== "string")
		throw new GenerationProviderError(false, "result_pending");
	const imageUrl = new URL(image.url);
	if (
		imageUrl.protocol !== "https:" ||
		imageUrl.username ||
		imageUrl.password ||
		imageUrl.port ||
		!(
			imageUrl.hostname === "fal.media" ||
			imageUrl.hostname.endsWith(".fal.media")
		)
	)
		throw new GenerationProviderError(false, "result_pending");
	try {
		const { response, bytes } = await responseBytes(
			transport,
			imageUrl.href,
			{},
			MAX_IMAGE_BYTES,
		);
		const contentType = response.headers
			.get("content-type")
			?.split(";")[0]
			.toLowerCase();
		return {
			status: "succeeded",
			image: validateImage(bytes, contentType, image.width, image.height),
		};
	} catch {
		throw new GenerationProviderError(false, "result_pending");
	}
}
export function validateImage(
	bytes: Uint8Array,
	type: unknown,
	width?: unknown,
	height?: unknown,
): ImageOutput {
	if (
		!bytes.length ||
		bytes.length > MAX_IMAGE_BYTES ||
		(type !== "image/jpeg" && type !== "image/png")
	)
		throw new GenerationProviderError(false, "result_pending");
	try {
		validateMagicBytes(bytes, type);
	} catch {
		throw new GenerationProviderError(false, "result_pending");
	}
	const dimension = (n: unknown) =>
		typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 4096
			? n
			: null;
	return {
		bytes,
		contentType: type,
		width: dimension(width),
		height: dimension(height),
	};
}
export async function generateWorkers(
	env: Bindings,
	input: GenerationInput,
	transport: Transport = fetch,
): Promise<ImageOutput> {
	const data = await json(
		transport,
		`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${AI_PROVIDER_MODELS.workersImage["flux-1-schnell"]}`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.CLOUDFLARE_AI_API_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ prompt: input.prompt, steps: 4 }),
		},
		12 * 1024 * 1024,
		45000,
	);
	if (data.success === false)
		throw new GenerationProviderError(true, "provider_failed");
	if (data.success !== true) throw new GenerationProviderError();
	const output = record(data.result);
	if (
		typeof output.image !== "string" ||
		output.image.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(output.image)
	)
		throw new GenerationProviderError();
	let bytes: Uint8Array;
	try {
		bytes = Uint8Array.from(atob(output.image), (character) =>
			character.charCodeAt(0),
		);
	} catch {
		throw new GenerationProviderError();
	}
	return validateImage(bytes, "image/jpeg");
}
