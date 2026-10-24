import "@tanstack/react-start/server-only";
import {
	AI_MODEL_UNITS,
	aiPolicyIssue,
	type AiModelKey,
	type AiUsagePolicy,
} from "./policy";

export type AiOutcome = "pending" | "succeeded" | "released" | "unknown";
type Status = "reserved" | "running" | "succeeded" | "released" | "unknown";
interface UsageRow {
	user_key: string;
	request_id: string;
	payload_hash: string;
	model_key: string;
	day: string;
	units: number;
	status: Status;
	provider_job_id: string | null;
	provider_model: string | null;
	lease_until: number;
	created_at: number;
	updated_at: number;
}
export interface AiRequestState {
	requestId: string;
	outcome: AiOutcome;
	providerJobId?: string;
	providerModel?: string;
	retryable: false;
}
export class AiUsageError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly status: number,
		public readonly requestId?: string,
		public readonly outcome: AiOutcome | "not_started" = "not_started",
	) {
		super(message);
		this.name = "AiUsageError";
	}
}
export function aiRequestId(value: string | null): string {
	if (!value || !/^[A-Za-z0-9_-]{16,128}$/.test(value))
		throw new AiUsageError(
			"AI_REQUEST_ID_REQUIRED",
			"Send a stable Idempotency-Key of 16–128 letters, digits, hyphens or underscores.",
			400,
		);
	return value;
}
async function digest(value: string): Promise<string> {
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(hash)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
function state(row: UsageRow, now: number): AiRequestState {
	const outcome =
		row.status === "reserved"
			? row.lease_until > now
				? "pending"
				: "released"
			: row.status === "running"
				? row.lease_until > now
					? "pending"
					: "unknown"
				: row.status;
	return {
		requestId: row.request_id,
		outcome,
		...(row.provider_job_id ? { providerJobId: row.provider_job_id } : {}),
		...(row.provider_model ? { providerModel: row.provider_model } : {}),
		retryable: false,
	};
}
export async function getAiRequestState(
	db: D1Database,
	userId: string,
	requestId: string,
	now = Date.now(),
): Promise<AiRequestState | null> {
	const row = await db
		.prepare(
			"SELECT * FROM ai_usage_requests WHERE user_key=? AND request_id=?",
		)
		.bind(await digest(userId), aiRequestId(requestId))
		.first<UsageRow>();
	return row ? state(row, now) : null;
}
export interface AiReservation {
	userKey: string;
	requestId: string;
	leaseUntil: number;
	leaseDurationMs: number;
}

/**
 * The limit predicates and insert are ONE D1 write statement. Never split this
 * into a read/count followed by an insert: concurrent requests would overspend.
 * All admitted attempts count toward daily requests, bounding row growth even
 * for validation/configuration failures. Only units/concurrency are released
 * before dispatch. Unknown dispatches retain units. Dispatch requires an
 * unexpired reservation and extends its slot for the full provider time bound.
 */
export async function reserveAiUsage(
	db: D1Database,
	policy: AiUsagePolicy,
	input: {
		userId: string;
		requestId: string;
		payload: unknown;
		modelKey: AiModelKey;
	},
	now = Date.now(),
): Promise<
	| { acquired: true; reservation: AiReservation }
	| { acquired: false; state: AiRequestState }
> {
	const requestId = aiRequestId(input.requestId);
	if (!policy.enabled)
		throw new AiUsageError(
			"AI_DISABLED",
			"AI is disabled by the site owner.",
			503,
			requestId,
		);
	if (aiPolicyIssue(policy))
		throw new AiUsageError(
			"AI_POLICY_INVALID",
			"AI limits are not configured safely.",
			503,
			requestId,
		);
	const units = AI_MODEL_UNITS[input.modelKey];
	if (!Number.isSafeInteger(units) || units <= 0)
		throw new AiUsageError(
			"AI_MODEL_UNCONFIGURED",
			"This model has no capacity budget.",
			503,
			requestId,
		);
	const userKey = await digest(input.userId);
	const payloadHash = await digest(JSON.stringify(input.payload));
	const day = new Date(now).toISOString().slice(0, 10);
	const leaseUntil = now + policy.leaseSeconds * 1000;
	const charged =
		"(status IN ('running','succeeded','unknown') OR (status='reserved' AND lease_until>?))";
	const inserted = await db
		.prepare(`INSERT INTO ai_usage_requests
			(user_key,request_id,payload_hash,model_key,day,units,status,lease_until,created_at,updated_at)
			SELECT ?,?,?,?,?,?,'reserved',?,?,?
			WHERE (SELECT COUNT(*) FROM ai_usage_requests WHERE day=?) < ?
			AND (SELECT COALESCE(SUM(units),0) FROM ai_usage_requests WHERE day=? AND ${charged}) + ? <= ?
			AND (SELECT COUNT(*) FROM ai_usage_requests WHERE user_key=? AND day=?) < ?
			AND (SELECT COALESCE(SUM(units),0) FROM ai_usage_requests WHERE user_key=? AND day=? AND ${charged}) + ? <= ?
			AND (SELECT COUNT(*) FROM ai_usage_requests WHERE status IN ('reserved','running','unknown') AND lease_until>?) < ?
			AND (SELECT COUNT(*) FROM ai_usage_requests WHERE user_key=? AND status IN ('reserved','running','unknown') AND lease_until>?) < ?
			ON CONFLICT(user_key,request_id) DO NOTHING RETURNING *`)
		.bind(
			userKey,
			requestId,
			payloadHash,
			input.modelKey,
			day,
			units,
			leaseUntil,
			now,
			now,
			day,
			policy.globalDailyRequests,
			day,
			now,
			units,
			policy.globalDailyUnits,
			userKey,
			day,
			policy.userDailyRequests,
			userKey,
			day,
			now,
			units,
			policy.userDailyUnits,
			now,
			policy.globalConcurrent,
			userKey,
			now,
			policy.userConcurrent,
		)
		.first<UsageRow>();
	if (inserted)
		return {
			acquired: true,
			reservation: {
				userKey,
				requestId,
				leaseUntil,
				leaseDurationMs: policy.leaseSeconds * 1000,
			},
		};
	const existing = await db
		.prepare(
			"SELECT * FROM ai_usage_requests WHERE user_key=? AND request_id=?",
		)
		.bind(userKey, requestId)
		.first<UsageRow>();
	if (existing) {
		if (
			existing.payload_hash !== payloadHash ||
			existing.model_key !== input.modelKey
		)
			throw new AiUsageError(
				"AI_REQUEST_CONFLICT",
				"This request ID already belongs to different input. No new provider call was made.",
				409,
				requestId,
				state(existing, now).outcome,
			);
		return { acquired: false, state: state(existing, now) };
	}
	throw new AiUsageError(
		"AI_LIMIT_REACHED",
		"The AI daily budget or concurrent-request limit has been reached. No provider call was made.",
		429,
		requestId,
	);
}

export async function markAiDispatched(
	db: D1Database,
	reservation: AiReservation,
	now = Date.now(),
): Promise<void> {
	const updated = await db
		.prepare(
			"UPDATE ai_usage_requests SET status='running',updated_at=?,lease_until=? WHERE user_key=? AND request_id=? AND status='reserved' AND lease_until>? RETURNING request_id",
		)
		.bind(
			now,
			now + reservation.leaseDurationMs,
			reservation.userKey,
			reservation.requestId,
			now,
		)
		.first();
	if (!updated)
		throw new AiUsageError(
			"AI_REQUEST_RELEASED",
			"The dispatch lease expired or is no longer available. No new provider call was made.",
			409,
			reservation.requestId,
			"released",
		);
}

export async function recordAiProviderJob(
	db: D1Database,
	reservation: AiReservation,
	job: { requestId: string; model: string },
	now = Date.now(),
): Promise<void> {
	if (
		!/^[A-Za-z0-9_-]{1,128}$/.test(job.requestId) ||
		!/^[A-Za-z0-9_/-]{1,128}$/.test(job.model)
	)
		throw new Error("Provider returned an invalid job reference.");
	const updated = await db
		.prepare(
			"UPDATE ai_usage_requests SET provider_job_id=?,provider_model=?,updated_at=? WHERE user_key=? AND request_id=? AND status='running' AND provider_job_id IS NULL RETURNING request_id",
		)
		.bind(
			job.requestId,
			job.model,
			now,
			reservation.userKey,
			reservation.requestId,
		)
		.first();
	if (!updated)
		throw new Error("Provider job reference could not be recorded.");
}

export async function finishAiUsage(
	db: D1Database,
	reservation: AiReservation,
	outcome: "succeeded" | "released" | "unknown",
	now = Date.now(),
): Promise<void> {
	// Only a never-dispatched reservation can be refunded. Once dispatched,
	// even HTTP 4xx/5xx or malformed output is not proof that no cost occurred.
	const from = outcome === "released" ? "reserved" : "running";
	const updated = await db
		.prepare(
			"UPDATE ai_usage_requests SET status=?,updated_at=? WHERE user_key=? AND request_id=? AND status=? RETURNING request_id",
		)
		.bind(outcome, now, reservation.userKey, reservation.requestId, from)
		.first();
	if (!updated) throw new Error("AI outcome could not be persisted.");
}

/** Bounded maintenance, safe to call even while new AI dispatch is disabled. */
export async function pruneAiUsage(
	db: D1Database,
	retentionDays: number,
	limit = 100,
	now = Date.now(),
): Promise<{ expired: number; removed: number }> {
	if (
		!Number.isSafeInteger(retentionDays) ||
		retentionDays < 1 ||
		retentionDays > 365 ||
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > 100
	)
		throw new Error("Invalid AI usage retention policy.");
	// Expiration is not proof of failure/cancellation. Running -> unknown always
	// retains both budget and provider job references; only undispatched expires.
	const expired = await db
		.prepare(`UPDATE ai_usage_requests
		SET status=CASE WHEN status='reserved' THEN 'released' ELSE 'unknown' END, updated_at=?
		WHERE (user_key,request_id) IN (
			SELECT user_key,request_id FROM ai_usage_requests WHERE status IN ('reserved','running') AND lease_until<=? ORDER BY lease_until LIMIT ?
		)`)
		.bind(now, now, limit)
		.run();
	const removed = await db
		.prepare(`DELETE FROM ai_usage_requests WHERE (user_key,request_id) IN (
		SELECT user_key,request_id FROM ai_usage_requests WHERE status IN ('succeeded','released') AND updated_at<? ORDER BY updated_at LIMIT ?
	)`)
		.bind(now - retentionDays * 86_400_000, limit)
		.run();
	return { expired: expired.meta.changes, removed: removed.meta.changes };
}
