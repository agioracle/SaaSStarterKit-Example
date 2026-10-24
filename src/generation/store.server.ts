import "@tanstack/react-start/server-only";
import { websiteConfig } from "../config/website";
import { aiPolicyIssue, AI_MODEL_UNITS } from "../ai/policy";
import { HttpError } from "../lib/security";
import type {
	GenerationInput,
	GenerationJob,
	GenerationProvider,
	GenerationStatus,
	GenerationUsage,
	ModelId,
	AspectRatio,
} from "./types";
import { utcPeriod } from "./validation";

export interface JobRow {
	id: string;
	user_id: string;
	idempotency_key: string;
	request_hash: string;
	model: ModelId;
	provider: GenerationProvider;
	prompt: string;
	aspect_ratio: AspectRatio;
	seed: number | null;
	status: GenerationStatus;
	billing_state: "reserved" | "charged" | "released";
	period: string;
	provider_request_id: string | null;
	error_code: string | null;
	object_key: string;
	content_type: string | null;
	byte_size: number | null;
	width: number | null;
	height: number | null;
	created_at: number;
	updated_at: number;
	poll_token: string | null;
	poll_after: number;
}
export type Policy = Pick<
	GenerationUsage,
	"plan" | "limit" | "retainedLimit" | "concurrencyLimit"
>;
const ERRORS: Record<string, string> = {
	dispatch_uncertain:
		"The provider outcome is uncertain. This credit remains reserved; do not submit a duplicate. Contact support if recovery does not resolve it.",
	provider_rejected:
		"The provider rejected this request. No credit was charged. Review your prompt or ask the site owner to check provider configuration.",
	provider_failed:
		"The provider confirmed this generation failed. Your credit was released.",
	safety_blocked:
		"The provider safety check blocked this output after generation. One credit was consumed, and no image is available.",
	result_pending:
		"The generated result could not yet be saved. Recovery only retrieves the existing result and never creates another image.",
	manually_charged:
		"Support confirmed this request consumed a credit. The image is unavailable; no automatic retry was made.",
	manually_released:
		"Support confirmed this request did not consume a credit and released the reservation.",
};
export function publicJob(row: JobRow): GenerationJob {
	return {
		id: row.id,
		model: row.model,
		provider: row.provider,
		prompt: row.prompt,
		aspectRatio: row.aspect_ratio,
		seed: row.seed,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		error: row.error_code
			? ERRORS[row.error_code] || "This request needs support review."
			: null,
		assetUrl:
			row.status === "succeeded" ? `/api/generations/${row.id}/asset` : null,
		downloadUrl:
			row.status === "succeeded"
				? `/api/generations/${row.id}/asset?download=1`
				: null,
		canRefresh:
			row.billing_state === "reserved" &&
			(Boolean(row.provider_request_id) || row.provider === "cloudflare"),
		canDelete: ["succeeded", "failed", "deleting"].includes(row.status),
		width: row.width,
		height: row.height,
	};
}
export async function requireGenerationSchema(db: D1Database) {
	const found = await db
		.prepare(
			"SELECT COUNT(*) AS count FROM sqlite_master WHERE (type='trigger' AND name='account_deletion_freezes_generations') OR (type='index' AND name IN ('generation_jobs_owner_idempotency_unique','generation_jobs_object_key_unique')) OR (type='table' AND name='generation_reconciliations')",
		)
		.first<number>("count");
	const columns = await db
		.prepare("PRAGMA table_info(generation_jobs)")
		.all<{ name: string }>();
	const capacity = await db
		.prepare(
			"SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('generation_capacity','generation_capacity_insert','generation_capacity_settle','generation_capacity_delete')",
		)
		.first<number>("n");
	if (
		found !== 4 ||
		capacity !== 4 ||
		!columns.results.some((c) => c.name === "capacity_units")
	)
		throw new HttpError(
			503,
			"Image storage requires the latest database migrations. Contact the site owner.",
		);
}
export async function ownedJob(db: D1Database, userId: string, id: string) {
	const row = await db
		.prepare("SELECT * FROM generation_jobs WHERE id=? AND user_id=?")
		.bind(id, userId)
		.first<JobRow>();
	if (!row) throw new HttpError(404, "Image request not found.");
	return row;
}
export async function usage(
	db: D1Database,
	userId: string,
	policy: Policy,
	now = Date.now(),
): Promise<GenerationUsage> {
	const period = utcPeriod(now);
	const counts = await db
		.prepare(`SELECT
    COALESCE(SUM(CASE WHEN period=? AND billing_state='charged' THEN 1 ELSE 0 END),0) used,
    COALESCE(SUM(CASE WHEN period=? AND billing_state='reserved' THEN 1 ELSE 0 END),0) reserved,
    COALESCE(SUM(CASE WHEN billing_state='reserved' THEN 1 ELSE 0 END),0) active,
    COALESCE(SUM(CASE WHEN status!='deleted' THEN 1 ELSE 0 END),0) retained
    FROM generation_jobs WHERE user_id=?`)
		.bind(period, period, userId)
		.first<{
			used: number;
			reserved: number;
			active: number;
			retained: number;
		}>();
	const values = counts || { used: 0, reserved: 0, active: 0, retained: 0 };
	return {
		...policy,
		period,
		...values,
		remaining: Math.max(0, policy.limit - values.used - values.reserved),
	};
}
export async function requestHash(input: GenerationInput) {
	const bytes = new TextEncoder().encode(
		JSON.stringify([
			input.model,
			input.prompt,
			input.aspectRatio,
			input.seed ?? null,
		]),
	);
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
		.map((n) => n.toString(16).padStart(2, "0"))
		.join("");
}
export async function existingRequest(
	db: D1Database,
	userId: string,
	input: GenerationInput,
	hash: string,
) {
	const existing = await db
		.prepare(
			"SELECT * FROM generation_jobs WHERE user_id=? AND idempotency_key=?",
		)
		.bind(userId, input.idempotencyKey)
		.first<JobRow>();
	if (existing && existing.request_hash !== hash)
		throw new HttpError(
			409,
			"This request key was already used with different settings. Start a new request explicitly.",
		);
	return existing;
}
export async function reserveJob(
	db: D1Database,
	userId: string,
	input: GenerationInput,
	hash: string,
	policy: Policy,
	now = Date.now(),
) {
	const budget = websiteConfig.ai;
	if (!budget.enabled || aiPolicyIssue(budget))
		throw new HttpError(503, "AI is disabled or its safety budget is invalid.");
	const units =
		AI_MODEL_UNITS[
			input.model === "fal-flux-schnell"
				? "fal-image:flux-schnell"
				: "workers-image:flux-1-schnell"
		];
	const day = new Date(now).toISOString().slice(0, 10);
	const dayStart = Date.parse(`${day}T00:00:00Z`);
	const userKey = [
		...new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId)),
		),
	]
		.map((n) => n.toString(16).padStart(2, "0"))
		.join("");
	const id = crypto.randomUUID();
	const period = utcPeriod(now);
	// One SQLite write evaluates every guard and inserts the reservation atomically.
	// Existing keys win before quota checks; only this insert's winner may call inference.
	const result = await db
		.prepare(`INSERT INTO generation_jobs
    (id,user_id,idempotency_key,request_hash,model,provider,prompt,aspect_ratio,seed,status,billing_state,period,object_key,created_at,updated_at,capacity_units,capacity_user_key)
    SELECT ?,?,?,?,?,?,?,?,?,'dispatching','reserved',?,?,?,?,?,?
    WHERE NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=?)
    AND (SELECT COUNT(*) FROM generation_jobs WHERE user_id=? AND period=? AND billing_state IN ('reserved','charged')) < ?
    AND (SELECT COUNT(*) FROM generation_jobs WHERE user_id=? AND billing_state='reserved') < ?
    AND (SELECT COUNT(*) FROM generation_jobs WHERE user_id=? AND status!='deleted') < ?
    AND ((SELECT COUNT(*) FROM generation_capacity WHERE created_at>=? AND created_at<?) + (SELECT COUNT(*) FROM ai_usage_requests WHERE day=?)) < ?
    AND ((SELECT COALESCE(SUM(units),0) FROM generation_capacity WHERE created_at>=? AND created_at<?) + (SELECT COALESCE(SUM(units),0) FROM ai_usage_requests WHERE day=? AND status!='released')) + ? <= ?
    AND ((SELECT COUNT(*) FROM generation_capacity WHERE (user_key=? OR job_id IN (SELECT id FROM generation_jobs WHERE user_id=?)) AND created_at>=? AND created_at<?) + (SELECT COUNT(*) FROM ai_usage_requests WHERE user_key=? AND day=?)) < ?
    AND ((SELECT COALESCE(SUM(units),0) FROM generation_capacity WHERE (user_key=? OR job_id IN (SELECT id FROM generation_jobs WHERE user_id=?)) AND created_at>=? AND created_at<?) + (SELECT COALESCE(SUM(units),0) FROM ai_usage_requests WHERE user_key=? AND day=? AND status!='released')) + ? <= ?
    AND ((SELECT COUNT(*) FROM generation_capacity WHERE active=1) + (SELECT COUNT(*) FROM ai_usage_requests WHERE status IN ('running','unknown') OR (status='reserved' AND lease_until>?))) < ?
    AND ((SELECT COUNT(*) FROM generation_capacity WHERE active=1 AND (user_key=? OR job_id IN (SELECT id FROM generation_jobs WHERE user_id=?))) + (SELECT COUNT(*) FROM ai_usage_requests WHERE user_key=? AND (status IN ('running','unknown') OR (status='reserved' AND lease_until>?)))) < ?
    ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id`)
		.bind(
			id,
			userId,
			input.idempotencyKey,
			hash,
			input.model,
			input.model === "fal-flux-schnell" ? "fal" : "cloudflare",
			input.prompt,
			input.aspectRatio,
			input.seed ?? null,
			period,
			`generations/${userId}/${id}`,
			now,
			now,
			units,
			userKey,
			userId,
			userId,
			period,
			policy.limit,
			userId,
			policy.concurrencyLimit,
			userId,
			policy.retainedLimit,
			dayStart,
			dayStart + 86400000,
			day,
			budget.globalDailyRequests,
			dayStart,
			dayStart + 86400000,
			day,
			units,
			budget.globalDailyUnits,
			userKey,
			userId,
			dayStart,
			dayStart + 86400000,
			userKey,
			day,
			budget.userDailyRequests,
			userKey,
			userId,
			dayStart,
			dayStart + 86400000,
			userKey,
			day,
			units,
			budget.userDailyUnits,
			now,
			budget.globalConcurrent,
			userKey,
			userId,
			userKey,
			now,
			budget.userConcurrent,
		)
		.first<{ id: string }>();
	const row = await existingRequest(db, userId, input, hash);
	if (row) return { row, created: Boolean(result) };
	if (
		await db
			.prepare("SELECT user_id FROM account_deletions WHERE user_id=?")
			.bind(userId)
			.first()
	)
		throw new HttpError(409, "Account deletion is in progress.");
	const current = await usage(db, userId, policy, now);
	if (current.remaining === 0)
		throw new HttpError(
			429,
			"Your UTC-month image quota is exhausted. Upgrade your plan or wait for the next month.",
		);
	if (current.active >= policy.concurrencyLimit)
		throw new HttpError(
			429,
			"Your active image request limit is reached. Wait for existing requests or resolve uncertain requests with support.",
		);
	if (current.retained < policy.retainedLimit)
		throw new HttpError(
			429,
			"The AI daily safety budget or global concurrency limit has been reached. No provider call was made.",
		);
	throw new HttpError(
		409,
		"Your retained image limit is reached. Delete images before generating more.",
	);
}
export async function markUnknown(
	db: D1Database,
	row: JobRow,
	code = "dispatch_uncertain",
	token: string | null = null,
) {
	await db
		.prepare(
			"UPDATE generation_jobs SET status='unknown',error_code=?,updated_at=? WHERE id=? AND billing_state='reserved' AND poll_token IS ?",
		)
		.bind(code, Date.now(), row.id, token)
		.run();
}
export async function failJob(
	db: D1Database,
	row: JobRow,
	code = "provider_failed",
	token: string | null = null,
) {
	await db
		.prepare(
			"UPDATE generation_jobs SET status='failed',billing_state=?,error_code=?,poll_token=NULL,updated_at=? WHERE id=? AND billing_state='reserved' AND poll_token IS ?",
		)
		.bind(
			code === "safety_blocked" ? "charged" : "released",
			code,
			Date.now(),
			row.id,
			token,
		)
		.run();
}
export async function recoverStaleDispatch(
	db: D1Database,
	userId: string,
	now = Date.now(),
) {
	await db
		.prepare(
			"UPDATE generation_jobs SET status='unknown',error_code='dispatch_uncertain',updated_at=? WHERE user_id=? AND status='dispatching' AND updated_at < ?",
		)
		.bind(now, userId, now - 120000)
		.run();
}

/** Bounded removal of settled capacity records; unresolved capacity never expires. */
export async function pruneGenerationCapacity(
	db: D1Database,
	retentionDays: number,
	now = Date.now(),
) {
	if (
		!Number.isInteger(retentionDays) ||
		retentionDays < 1 ||
		retentionDays > 365
	)
		throw Error("Invalid capacity retention.");
	return db
		.prepare(
			"DELETE FROM generation_capacity WHERE job_id IN (SELECT job_id FROM generation_capacity WHERE active=0 AND created_at<? ORDER BY created_at LIMIT 100)",
		)
		.bind(now - retentionDays * 86400000)
		.run();
}
