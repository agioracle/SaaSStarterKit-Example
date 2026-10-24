/** Explicit allowlist, never serialize Error/message/stack/body/URLs or auth data. */
export interface DiagnosticContext {
	operation?: string;
	provider?: string;
	eventId?: string;
	requestId?: string;
	durationMs?: number;
}
const codes = new Set([
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
]);
const providers = new Set([
	"stripe",
	"creem",
	"waffo",
	"cloudflare",
	"fal",
	"resend",
	"beehiiv",
	"mailcheap",
	"discord",
	"feishu",
]);
export function diagnosticCode(error: unknown): string {
	if (
		error &&
		typeof error === "object" &&
		"code" in error &&
		typeof error.code === "string" &&
		codes.has(error.code)
	)
		return error.code;
	if (error instanceof Error && error.name === "HttpError") return "HTTP_ERROR";
	if (error instanceof Error && error.name === "ZodError") return "VALIDATION";
	return "INTERNAL_ERROR";
}
export function newRequestId() {
	return crypto.randomUUID();
}
export function logDiagnostic(error: unknown, context: DiagnosticContext = {}) {
	const record: Record<string, string | number> = {
		event: "operation_failed",
		operation:
			context.operation && /^[a-z][a-z0-9_.-]{0,63}$/.test(context.operation)
				? context.operation
				: "request",
		code: diagnosticCode(error),
	};
	if (context.provider && providers.has(context.provider))
		record.provider = context.provider;
	if (context.requestId && /^[a-f0-9-]{36}$/.test(context.requestId))
		record.requestId = context.requestId;
	if (context.eventId && /^[A-Za-z0-9_.:-]{1,160}$/.test(context.eventId))
		record.eventId = context.eventId;
	if (
		typeof context.durationMs === "number" &&
		Number.isFinite(context.durationMs)
	)
		record.durationMs = Math.max(
			0,
			Math.min(3600000, Math.round(context.durationMs)),
		);
	if (
		error &&
		typeof error === "object" &&
		"status" in error &&
		typeof error.status === "number" &&
		Number.isInteger(error.status) &&
		error.status >= 100 &&
		error.status <= 599
	)
		record.upstreamStatus = error.status;
	console.error(JSON.stringify(record));
	return record;
}
