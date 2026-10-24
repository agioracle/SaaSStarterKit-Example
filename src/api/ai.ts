import "@tanstack/react-start/server-only";
import type { AiTaskInput } from "../ai/tasks/index.server";
import { handleApi } from "./index.server";
import { json } from "../lib/security";

/** Independent server-call contract. Pass the real incoming POST, not invented auth/origin headers. */
export interface AiActionContext {
	request: Request;
	/** Stable for this exact operation; never generate a new ID to retry an uncertain result. */
	requestId: string;
}
export type SearchWebInput = Omit<
	Extract<AiTaskInput, { task: "web-search" }>,
	"task"
>;
export type EvaluateTicketInput = Omit<
	Extract<AiTaskInput, { task: "decision" }>,
	"task"
>;

/**
 * Explicitly independent facade for all ten canonical tasks. This is a server-only
 * function, not a TanStack Start RPC action. Auth, CSRF, kill switch, rate limits,
 * durable admission and no-retry dispatch still run through the actual API router.
 * Returning Response unchanged preserves JSON/audio and structured error metadata.
 */
export async function dispatchAiTask(
	input: AiTaskInput,
	context: AiActionContext,
): Promise<Response> {
	if (context.request.method !== "POST")
		return json(
			{
				error: "AI actions require an incoming POST request.",
				code: "HTTP_ERROR",
			},
			405,
		);
	const headers = new Headers(context.request.headers);
	const incomingId = headers.get("Idempotency-Key");
	if (incomingId !== null && incomingId !== context.requestId)
		return json(
			{
				error: "The request reference must match the incoming Idempotency-Key.",
				code: "AI_REQUEST_CONFLICT",
				outcome: "not_started",
				retryable: false,
			},
			409,
		);
	// The body is re-encoded, so the incoming representation headers no longer apply.
	headers.delete("Content-Length");
	headers.delete("Content-Encoding");
	headers.set("Content-Type", "application/json");
	headers.set("Idempotency-Key", context.requestId);
	// Do not synthesize Origin or authentication. Missing/foreign origins and missing
	// sessions must fail at the same boundary as an ordinary /api/ai request.
	return handleApi(
		new Request(new URL("/api/ai", context.request.url), {
			method: "POST",
			headers,
			body: JSON.stringify(input),
			signal: context.request.signal,
		}),
	);
}

/** Publicly documented operation name; parameters are this starter's documented contract. */
export function searchWeb(
	input: SearchWebInput,
	context: AiActionContext,
): Promise<Response> {
	return dispatchAiTask({ ...input, task: "web-search" }, context);
}
/** Publicly documented operation name; no unpublished reference signature is implied. */
export function evaluateTicket(
	input: EvaluateTicketInput,
	context: AiActionContext,
): Promise<Response> {
	return dispatchAiTask({ ...input, task: "decision" }, context);
}
