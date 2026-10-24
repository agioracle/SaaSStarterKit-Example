import { z } from "zod";
import {
	createAiService,
	aiConfigFromEnv,
	ServiceError,
} from "../ai/index.server";
import { defaultTransport, type FetchTransport } from "../ai/http.server";
import { aiModelKey, type AiUsagePolicy } from "../ai/policy";
import {
	aiPaymentDiagnostic,
	type AiProviderDiagnostic,
} from "../ai/diagnostics";
import {
	AiUsageError,
	aiRequestId,
	getAiRequestState,
	reserveAiUsage,
	markAiDispatched,
	recordAiProviderJob,
	finishAiUsage,
	type AiRequestState,
} from "../ai/usage.server";
import { websiteConfig } from "../config/website";
import { readJson, json, HttpError } from "../lib/security";
import type { Bindings } from "../env";
import { stringEnv } from "./runtime.server";
import { rateLimit } from "./rate-limit.server";
import { aiTaskSchema, runAiTask } from "../ai/tasks/index.server";

/** Injected transport is for ordinary local fixtures; production uses fetch. */
export interface AiHandlerOptions {
	policy?: AiUsagePolicy;
	transport?: FetchTransport;
}
function failure(
	error: AiUsageError,
	details?: Partial<AiRequestState> & AiProviderDiagnostic,
) {
	const response = json(
		{
			error: error.message,
			code: error.code,
			requestId: error.requestId,
			outcome: error.outcome,
			retryable: false,
			...details,
		},
		error.status,
	);
	if (error.requestId) response.headers.set("X-AI-Request-Id", error.requestId);
	response.headers.set("X-AI-Outcome", error.outcome);
	return response;
}
function duplicate(state: AiRequestState) {
	const messages = {
		pending: [
			"AI_REQUEST_PENDING",
			"This request is already in progress. Do not submit it again.",
		],
		unknown: [
			"UNKNOWN_OUTCOME",
			"The provider outcome is unknown and may have incurred a charge. Do not resubmit; ask the site owner to reconcile this request.",
		],
		succeeded: [
			"AI_ALREADY_COMPLETED",
			"This request already completed. Its output is not retained for replay; no new provider call was made.",
		],
		released: [
			"AI_REQUEST_RELEASED",
			"This request ended before provider dispatch. No new provider call was made; a new intentional request needs a new ID.",
		],
	} as const;
	const [code, message] = messages[state.outcome];
	return failure(
		new AiUsageError(
			code,
			message,
			state.outcome === "unknown" ? 502 : 409,
			state.requestId,
			state.outcome,
		),
		state,
	);
}

export async function handleAi(
	request: Request,
	env: Bindings,
	userId: string,
	options: AiHandlerOptions = {},
) {
	let validatedRequestId: string | undefined;
	try {
		// Status is read-only and remains available after the global kill switch.
		if (request.method === "GET") {
			const id = aiRequestId(
				new URL(request.url).searchParams.get("requestId"),
			);
			const state = await getAiRequestState(env.DB, userId, id);
			return state
				? json(state)
				: failure(
						new AiUsageError(
							"AI_REQUEST_NOT_FOUND",
							"AI request not found. No provider request was started by this status check.",
							404,
							id,
						),
					);
		}
		if (request.method !== "POST")
			throw new HttpError(405, "Method not allowed.");
		const policy = options.policy ?? websiteConfig.ai;
		// Keys in the environment and a newly registered account never enable spend.
		if (!policy.enabled)
			return failure(
				new AiUsageError(
					"AI_DISABLED",
					"AI is disabled by the site owner.",
					503,
				),
			);
		const requestId = aiRequestId(request.headers.get("Idempotency-Key"));
		validatedRequestId = requestId;
		await rateLimit(env.DB, `ai:${userId}`, 10, 60);
		const body = aiTaskSchema.parse(await readJson(request, 7_500_000));
		const claim = await reserveAiUsage(env.DB, policy, {
			userId,
			requestId,
			payload: body,
			modelKey: aiModelKey(body),
		});
		if (!claim.acquired) return duplicate(claim.state);
		let dispatched = false;
		let providerJob: { requestId: string; model: string } | undefined;
		const transport = options.transport ?? defaultTransport;
		const guardedTransport: FetchTransport = async (url, init) => {
			if ((init?.method ?? "POST").toUpperCase() !== "GET") {
				if (dispatched)
					throw new Error("A paid submission cannot be automatically retried.");
				await markAiDispatched(env.DB, claim.reservation);
				dispatched = true;
			}
			return transport(url, init);
		};
		try {
			const ai = createAiService(
				aiConfigFromEnv(stringEnv(env)),
				guardedTransport,
				{
					onProviderJob: async (job) => {
						providerJob = job;
						await recordAiProviderJob(env.DB, claim.reservation, job);
					},
				},
			);
			const response = await runAiTask(ai, body);
			await finishAiUsage(env.DB, claim.reservation, "succeeded");
			response.headers.set("X-AI-Request-Id", requestId);
			response.headers.set("X-AI-Outcome", "succeeded");
			return response;
		} catch (error) {
			const outcome = dispatched ? "unknown" : "released";
			try {
				await finishAiUsage(env.DB, claim.reservation, outcome);
			} catch {
				// Keep the original durable reservation. Expired running leases read
				// as unknown; never refund, erase or retry an uncertain dispatch.
			}
			const paymentRequired =
				error instanceof ServiceError && error.status === 402;
			if (dispatched)
				return failure(
					new AiUsageError(
						"UNKNOWN_OUTCOME",
						"The provider outcome is unknown and may have incurred a charge. Do not resubmit; ask the site owner to reconcile this request.",
						paymentRequired ? 402 : 502,
						requestId,
						"unknown",
					),
					{
						...(providerJob
							? {
									providerJobId: providerJob.requestId,
									providerModel: providerJob.model,
								}
							: {}),
						// An HTTP 402 is diagnostic evidence, not proof of no charge.
						// Keep unknown accounting and do not replay this request.
						...(paymentRequired ? aiPaymentDiagnostic(body.task) : {}),
					},
				);
			return failure(
				new AiUsageError(
					"AI_NOT_STARTED",
					error instanceof ServiceError && error.code === "VALIDATION"
						? error.message
						: "AI could not start. No provider call was made.",
					error instanceof ServiceError && error.code === "VALIDATION"
						? 400
						: 503,
					requestId,
					"released",
				),
				error instanceof ServiceError && error.code === "CONFIGURATION"
					? { setupHint: "CHECK_AI_CONFIGURATION" }
					: undefined,
			);
		}
	} catch (error) {
		if (error instanceof AiUsageError) return failure(error);
		// All dispatched execution is caught above. These are admission/input
		// failures, so callers can distinguish them from an unknown paid outcome.
		if (request.method === "POST") {
			const status =
				error instanceof HttpError
					? error.status
					: error instanceof z.ZodError
						? 400
						: 503;
			return failure(
				new AiUsageError(
					status === 400 || status === 413
						? "AI_INVALID_INPUT"
						: status === 429
							? "AI_LIMIT_REACHED"
							: "AI_NOT_STARTED",
					error instanceof HttpError
						? error.message
						: error instanceof z.ZodError
							? "Invalid AI request. No provider call was made."
							: "AI admission could not be recorded. No provider call was made.",
					status,
					validatedRequestId,
				),
			);
		}
		throw error;
	}
}
