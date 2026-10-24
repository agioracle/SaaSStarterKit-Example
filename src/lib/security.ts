import {
	diagnosticCode,
	logDiagnostic,
	newRequestId,
	type DiagnosticContext,
} from "./diagnostics";
export class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = "HttpError";
	}
}
export function safeReturnUrl(
	value: unknown,
	origin: string,
	fallback = "/settings/billing",
) {
	if (typeof value !== "string" || !value)
		return new URL(fallback, origin).href;
	const target = new URL(value, origin);
	const base = new URL(origin);
	if (
		target.origin !== base.origin ||
		!["https:", "http:"].includes(target.protocol) ||
		target.username ||
		target.password
	)
		throw new HttpError(400, "Return URL must use the application origin.");
	return target.href;
}
export function assertSameOrigin(request: Request, origin: string) {
	const incoming = request.headers.get("origin");
	if (!incoming || new URL(incoming).origin !== new URL(origin).origin)
		throw new HttpError(403, "Same-origin request required.");
}
export async function readJson(request: Request, limit = 64 * 1024) {
	const size = Number(request.headers.get("content-length") || "0");
	if (size > limit) throw new HttpError(413, "Request too large.");
	const reader = request.body?.getReader();
	if (!reader) throw new HttpError(400, "Request body required.");
	let count = 0;
	const parts: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		count += value.byteLength;
		if (count > limit) {
			await reader.cancel();
			throw new HttpError(413, "Request too large.");
		}
		parts.push(value);
	}
	const bytes = new Uint8Array(count);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	try {
		return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
	} catch {
		throw new HttpError(400, "Invalid JSON.");
	}
}
export function json(value: unknown, status = 200) {
	return Response.json(value, {
		status,
		headers: {
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
		},
	});
}
export function errorResponse(error: unknown, context: DiagnosticContext = {}) {
	const requestId = context.requestId || newRequestId();
	const code = diagnosticCode(error);
	logDiagnostic(error, { ...context, requestId });
	const failure = (value: Record<string, unknown>, status: number) => {
		const response = json({ ...value, code, requestId }, status);
		response.headers.set("X-Request-ID", requestId);
		return response;
	};
	if (code === "UNKNOWN_OUTCOME")
		return failure(
			{
				error:
					"The provider outcome is unknown. Do not submit another request. Keep this request ID and check its status.",
			},
			409,
		);

	if (
		error instanceof Error &&
		error.name === "ServiceError" &&
		"status" in error &&
		error.status === 402
	)
		return failure(
			{
				error:
					"Provider credits or billing are not configured. Ask the site owner to check the AI account and AI Gateway provider key.",
			},
			402,
		);
	if (
		error instanceof Error &&
		"code" in error &&
		typeof error.code === "string"
	) {
		const statuses: Record<string, number> = {
			NOT_FOUND: 404,
			UNAUTHORIZED: 401,
			INVALID_INPUT: 400,
			INVALID_SIGNATURE: 400,
			VALIDATION: 400,
			CONFIGURATION: 503,
			PROVIDER_ERROR: 502,
			UPSTREAM: 502,
			TIMEOUT: 504,
			RETRY: 503,
			BUDGET_EXCEEDED: 429,
			CONCURRENCY_LIMIT: 429,
			IDEMPOTENCY_CONFLICT: 409,
			RECONCILIATION_REQUIRED: 409,
			NAMESPACE_MISMATCH: 503,
		};
		const status = statuses[error.code];
		if (status)
			return failure(
				{
					error:
						status >= 500
							? "Service unavailable or not configured."
							: error.message,
				},
				status,
			);
	}
	if (error instanceof HttpError)
		return failure({ error: error.message }, error.status);
	if (error instanceof Error && error.name === "ZodError")
		return failure({ error: "Invalid request." }, 400);
	return failure({ error: "Service unavailable or not configured." }, 503);
}
