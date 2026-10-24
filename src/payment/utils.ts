import { PaymentError } from "./types";
export type JsonObject = Record<string, unknown>;
export const object = (value: unknown): JsonObject =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as JsonObject)
		: {};
export const string = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;
export const id = (value: unknown): string | undefined =>
	string(value) ?? string(object(value).id);
export const array = (value: unknown): unknown[] =>
	Array.isArray(value) ? value : [];
export function timestamp(value: unknown, seconds = false): number | undefined {
	const parsed =
		typeof value === "number"
			? value * (seconds ? 1000 : 1)
			: typeof value === "string"
				? Date.parse(value)
				: NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
export function required(value: string | undefined, name: string): string {
	if (!value?.trim())
		throw new PaymentError("CONFIGURATION", `Missing ${name}`);
	return value;
}
export function requiredField(value: unknown, name: string): string {
	const result = string(value);
	if (!result)
		throw new PaymentError(
			"PROVIDER_ERROR",
			`Provider response omitted ${name}`,
		);
	return result;
}
export function parsePayload(rawBody: string): JsonObject {
	try {
		const parsed: unknown = JSON.parse(rawBody);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error();
		return parsed as JsonObject;
	} catch {
		throw new PaymentError("INVALID_SIGNATURE", "Invalid webhook payload");
	}
}
/** Exact scheme/host/port match. Reject protocol-relative URLs, credentials and backslashes. */
export function sameOriginReturnUrl(value: string, appOrigin: string): string {
	const base = new URL(appOrigin);
	if (
		!["https:", "http:"].includes(base.protocol) ||
		base.username ||
		base.password
	)
		throw new PaymentError("CONFIGURATION", "Invalid application origin");
	if (
		!value ||
		value.startsWith("//") ||
		value.includes("\\") ||
		[...value].some((character) => character.charCodeAt(0) <= 32)
	)
		throw new PaymentError("INVALID_INPUT", "Return URL must be same-origin");
	if (!value.startsWith("/") && !/^https?:\/\//i.test(value))
		throw new PaymentError(
			"INVALID_INPUT",
			"Return URL must be root-relative or absolute",
		);
	let url: URL;
	try {
		url = new URL(value, base.origin);
	} catch {
		throw new PaymentError("INVALID_INPUT", "Invalid return URL");
	}
	if (url.origin !== base.origin || url.username || url.password)
		throw new PaymentError("INVALID_INPUT", "Return URL must be same-origin");
	return url.toString();
}
export function hostedUrl(value: unknown): string {
	const candidate = requiredField(value, "hosted URL");
	try {
		const url = new URL(candidate);
		if (url.protocol !== "https:" || url.username || url.password)
			throw new Error();
		return url.toString();
	} catch {
		throw new PaymentError("PROVIDER_ERROR", "Invalid provider hosted URL");
	}
}
export async function jsonResponse(response: Response): Promise<JsonObject> {
	if (!response.ok)
		throw new PaymentError(
			"PROVIDER_ERROR",
			`Payment provider returned HTTP ${response.status}`,
		);
	let result: unknown;
	try {
		result = await response.json();
	} catch {
		throw new PaymentError("PROVIDER_ERROR", "Invalid provider JSON response");
	}
	return object(result);
}
export async function hmacHex(secret: string, input: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(input),
	);
	return [...new Uint8Array(signature)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
export function equalHex(a: string, b: string): boolean {
	if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
	let difference = 0;
	for (let index = 0; index < a.length; index++)
		difference |=
			a.toLowerCase().charCodeAt(index) ^ b.toLowerCase().charCodeAt(index);
	return difference === 0;
}
export function signatureParts(header: string): Map<string, string[]> {
	const result = new Map<string, string[]>();
	for (const part of header.split(",")) {
		const split = part.indexOf("=");
		if (split <= 0) continue;
		const key = part.slice(0, split).trim();
		const value = part.slice(split + 1).trim();
		result.set(key, [...(result.get(key) ?? []), value]);
	}
	return result;
}

/** Explicit public base URL is canonical; a conflicting server origin fails closed. */
export function paymentApplicationOrigin(
	serverUrl?: string,
	publicUrl?: string,
): string {
	const origin = (value: string) =>
		new URL(sameOriginReturnUrl("/", value)).origin;
	const configured = origin(publicUrl || serverUrl || "http://localhost:3000");
	if (publicUrl && serverUrl && origin(serverUrl) !== configured)
		throw new PaymentError(
			"CONFIGURATION",
			"APP_URL must match the public payment origin",
		);
	return configured;
}
