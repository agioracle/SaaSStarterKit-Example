import "@tanstack/react-start/server-only";
/** Shared server-side transport. Never send provider errors, credentials, or request bodies to clients. */
export type FetchTransport = (
	url: string,
	init?: RequestInit,
) => Promise<Response>;
export type ServiceErrorCode =
	| "CONFIGURATION"
	| "VALIDATION"
	| "UPSTREAM"
	| "TIMEOUT"
	| "UNVERIFIED_PROVIDER";
export class ServiceError extends Error {
	constructor(
		public readonly code: ServiceErrorCode,
		message: string,
		public readonly status?: number,
	) {
		super(message);
		this.name = "ServiceError";
	}
}
export const defaultTransport: FetchTransport = (url, init) => fetch(url, init);
export const requiredConfig = (
	value: string | undefined,
	name: string,
): string => {
	if (!value?.trim())
		throw new ServiceError("CONFIGURATION", `Missing configuration: ${name}`);
	return value.trim();
};
export function textInput(
	value: unknown,
	name: string,
	min: number,
	max: number,
): string {
	if (typeof value !== "string")
		throw new ServiceError("VALIDATION", `${name} must be text`);
	const result = value.trim();
	if (result.length < min || result.length > max)
		throw new ServiceError(
			"VALIDATION",
			`${name} must be ${min}–${max} characters`,
		);
	return result;
}
export function emailInput(value: unknown): string {
	const email = textInput(value, "Email", 3, 254);
	if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))
		throw new ServiceError("VALIDATION", "Invalid email address");
	return email.toLowerCase();
}
export function enumInput<T extends string>(
	value: unknown,
	values: readonly T[],
	name: string,
): T {
	if (typeof value !== "string" || !values.includes(value as T))
		throw new ServiceError("VALIDATION", `Invalid ${name}`);
	return value as T;
}
export function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new ServiceError("UPSTREAM", "Provider returned an invalid response");
	return value as Record<string, unknown>;
}
export function stringField(value: unknown): string {
	if (typeof value !== "string" || !value)
		throw new ServiceError(
			"UPSTREAM",
			"Provider response is missing a required field",
		);
	return value;
}
export function cfResult(value: unknown): Record<string, unknown> {
	const data = record(value);
	if (data.success === false)
		throw new ServiceError("UPSTREAM", "Cloudflare rejected the request");
	return record("result" in data ? data.result : data);
}
export function bearer(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}
export interface HttpOptions {
	method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
	headers?: Record<string, string>;
	json?: unknown;
	body?: BodyInit;
	signal?: AbortSignal;
	timeoutMs?: number;
	maxResponseBytes?: number;
}
async function readLimited(
	response: Response,
	max: number,
): Promise<Uint8Array> {
	if (Number(response.headers.get("content-length")) > max)
		throw new ServiceError("UPSTREAM", "Provider response exceeded size limit");
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > max) {
				await reader.cancel();
				throw new ServiceError(
					"UPSTREAM",
					"Provider response exceeded size limit",
				);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}
export async function requestBytes(
	transport: FetchTransport,
	url: string,
	options: HttpOptions = {},
): Promise<{ bytes: Uint8Array; contentType: string; headers: Headers }> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	if (options.signal?.aborted) controller.abort();
	else options.signal?.addEventListener("abort", abort, { once: true });
	const timer = setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? 30_000,
	);
	try {
		if (controller.signal.aborted)
			throw new ServiceError(
				"TIMEOUT",
				"Provider request timed out. Its outcome is unknown; do not automatically retry.",
			);
		const response = await transport(url, {
			method: options.method ?? "POST",
			headers: {
				...options.headers,
				...(options.json !== undefined
					? { "Content-Type": "application/json" }
					: {}),
			},
			body:
				options.json !== undefined
					? JSON.stringify(options.json)
					: options.body,
			signal: controller.signal,
			redirect: "error",
		});
		if (!response.ok) {
			await response.body?.cancel();
			const message =
				response.status === 402
					? "Provider credits or billing are not configured. Check the account and AI Gateway provider key."
					: `Provider request failed (HTTP ${response.status})`;
			throw new ServiceError("UPSTREAM", message, response.status);
		}
		return {
			bytes: await readLimited(
				response,
				options.maxResponseBytes ?? 2 * 1024 * 1024,
			),
			contentType: response.headers.get("content-type") ?? "",
			headers: response.headers,
		};
	} catch (error) {
		if (error instanceof ServiceError) throw error;
		if (controller.signal.aborted)
			throw new ServiceError(
				"TIMEOUT",
				"Provider request timed out. Its outcome is unknown; do not automatically retry.",
			);
		throw new ServiceError(
			"UPSTREAM",
			"Provider connection failed. Its outcome is unknown; do not automatically retry.",
		);
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", abort);
	}
}
export async function requestJson(
	transport: FetchTransport,
	url: string,
	options: HttpOptions = {},
): Promise<unknown> {
	const { bytes } = await requestBytes(transport, url, options);
	if (bytes.byteLength === 0) return null;
	try {
		return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
	} catch {
		throw new ServiceError("UPSTREAM", "Provider returned invalid JSON");
	}
}
export function dataImage(value: unknown, maxBytes = 1024 * 1024): string {
	if (typeof value !== "string")
		throw new ServiceError(
			"VALIDATION",
			"Image must be an inline PNG, JPEG, or WebP",
		);
	const match =
		/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
	if (!match || match[2].length % 4 !== 0)
		throw new ServiceError("VALIDATION", "Invalid image data URI");
	const decodedBytes =
		(match[2].length * 3) / 4 -
		(match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
	if (decodedBytes > maxBytes)
		throw new ServiceError("VALIDATION", `Image exceeds ${maxBytes} bytes`);
	const signature = atob(match[2].slice(0, 32));
	const valid =
		match[1] === "png"
			? signature.startsWith("\x89PNG\r\n\x1a\n")
			: match[1] === "jpeg"
				? signature.startsWith("\xff\xd8\xff")
				: signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP";
	if (!valid)
		throw new ServiceError(
			"VALIDATION",
			"Image content does not match its media type",
		);
	return value;
}
