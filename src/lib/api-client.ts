import {
	AI_PROVIDER_CODES,
	AI_SETUP_HINTS,
	type AiProviderCode,
	type AiSetupHint,
} from "../ai/diagnostics";
import type { AiClientOutcome } from "../ai/request-state";
import { m } from "../locale/paraglide/messages";

const publicCodes = [
	"NOT_FOUND",
	"UNAUTHORIZED",
	"INVALID_INPUT",
	"INVALID_SIGNATURE",
	"VALIDATION",
	"CONFIGURATION",
	"PROVIDER_ERROR",
	"UPSTREAM",
	"TIMEOUT",
	"RETRY",
	"UNKNOWN_OUTCOME",
	"BUDGET_EXCEEDED",
	"CONCURRENCY_LIMIT",
	"IDEMPOTENCY_CONFLICT",
	"RECONCILIATION_REQUIRED",
	"NAMESPACE_MISMATCH",
	"HTTP_ERROR",
	"INTERNAL_ERROR",
	"AI_ALREADY_COMPLETED",
	"AI_DISABLED",
	"AI_INVALID_INPUT",
	"AI_LIMIT_REACHED",
	"AI_MODEL_UNCONFIGURED",
	"AI_NOT_STARTED",
	"AI_POLICY_INVALID",
	"AI_REQUEST_CONFLICT",
	"AI_REQUEST_ID_REQUIRED",
	"AI_REQUEST_NOT_FOUND",
	"AI_REQUEST_PENDING",
	"AI_REQUEST_RELEASED",
	"AI_STATUS_UNAVAILABLE",
] as const;
const outcomes = [
	"pending",
	"unknown",
	"succeeded",
	"released",
	"not_started",
] as const;
const object = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
function allowed<T extends string>(
	value: unknown,
	values: readonly T[],
): T | undefined {
	return typeof value === "string" && values.includes(value as T)
		? (value as T)
		: undefined;
}
function safeRequestId(value: unknown): string | undefined {
	return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value)
		? value
		: undefined;
}

/** Retain only explicit, bounded public metadata. Never retain the response body. */
export class ApiError extends Error {
	readonly status: number;
	readonly code?: (typeof publicCodes)[number];
	readonly requestId?: string;
	readonly outcome?: AiClientOutcome;
	readonly setupHint?: AiSetupHint;
	readonly providerCode?: AiProviderCode;
	readonly retryable = false;

	constructor(
		status: number,
		body: unknown = {},
		headers?: Headers,
		fallbackRequestId?: string,
	) {
		super("Request failed.");
		this.name = "ApiError";
		this.status =
			Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
		const outer = object(body);
		const inner = object(outer.error);
		this.code =
			allowed(outer.code, publicCodes) ?? allowed(inner.code, publicCodes);
		this.requestId =
			safeRequestId(outer.requestId) ??
			safeRequestId(inner.requestId) ??
			safeRequestId(headers?.get("X-AI-Request-Id")) ??
			safeRequestId(headers?.get("X-Request-ID")) ??
			safeRequestId(fallbackRequestId);
		this.outcome =
			allowed(outer.outcome, outcomes) ?? allowed(inner.outcome, outcomes);
		this.setupHint =
			allowed(outer.setupHint, AI_SETUP_HINTS) ??
			allowed(inner.setupHint, AI_SETUP_HINTS);
		this.providerCode =
			allowed(outer.providerCode, AI_PROVIDER_CODES) ??
			allowed(inner.providerCode, AI_PROVIDER_CODES);
		this.message = errorMessage(this);
	}
}

/** Shared by JSON endpoints and the AI endpoint's JSON-or-audio response path. */
export async function apiError(
	response: Response,
	fallbackRequestId?: string,
): Promise<ApiError> {
	return new ApiError(
		response.status,
		await response.json().catch(() => null),
		response.headers,
		fallbackRequestId,
	);
}

export async function api<T = Record<string, unknown>>(
	path: string,
	options?: RequestInit,
): Promise<T> {
	const headers = new Headers(options?.headers);
	if (
		options?.body &&
		!(options.body instanceof FormData) &&
		!headers.has("Content-Type")
	)
		headers.set("Content-Type", "application/json");
	const response = await fetch(path, {
		credentials: "same-origin",
		...options,
		headers,
	});
	if (!response.ok) throw await apiError(response);
	return (await response.json()) as T;
}

function publicMessage(error: ApiError): string {
	if (error.code === "UNKNOWN_OUTCOME" || error.outcome === "unknown")
		return m.ai_usage_unknown();
	if (error.code === "AI_DISABLED") return m.ai_usage_disabled();
	if (error.code === "AI_REQUEST_PENDING" || error.outcome === "pending")
		return m.ai_usage_pending();
	if (error.code === "AI_ALREADY_COMPLETED") return m.ai_usage_completed();
	if (error.code === "AI_REQUEST_RELEASED") return m.ai_usage_released();
	if (
		error.code === "AI_REQUEST_NOT_FOUND" ||
		error.code === "AI_STATUS_UNAVAILABLE"
	)
		return m.ai_usage_state_failed();
	if (error.code === "AI_NOT_STARTED" && error.status >= 500)
		return m.ai_diagnostic_not_started();
	if (error.code === "RECONCILIATION_REQUIRED")
		return m.ai_diagnostic_reconciliation();
	if (error.status === 401) return m.ai_diagnostic_sign_in();
	if (error.status === 403) return m.ai_diagnostic_forbidden();
	if (error.status === 404) return m.ai_diagnostic_not_found();
	if (error.status === 409) return m.ai_diagnostic_conflict();
	if (error.status === 429) return m.ai_diagnostic_limit();
	if (error.status === 400 || error.status === 413 || error.status === 422)
		return m.ai_diagnostic_invalid_input();
	return m.ai_diagnostic_request_failed({ status: error.status });
}

export function errorMessage(error: unknown): string {
	if (!(error instanceof ApiError))
		return error instanceof Error
			? error.message
			: m.ui_primitives_something_went_wrong_please_try_again();
	const parts = [publicMessage(error)];
	const hint =
		error.setupHint === "CHECK_AI_GATEWAY_FUNDING"
			? m.ai_diagnostic_gateway_funding()
			: error.setupHint === "CHECK_FAL_BILLING"
				? m.ai_diagnostic_fal_billing()
				: error.setupHint === "CHECK_WORKERS_AI_BILLING"
					? m.ai_diagnostic_workers_billing()
					: error.setupHint === "CHECK_AI_CONFIGURATION"
						? m.ai_diagnostic_configuration()
						: error.status === 402
							? m.ai_diagnostic_billing()
							: undefined;
	if (hint) parts.push(hint);
	if (error.requestId)
		parts.push(m.ai_diagnostic_request_reference({ id: error.requestId }));
	return parts.join("\n");
}
