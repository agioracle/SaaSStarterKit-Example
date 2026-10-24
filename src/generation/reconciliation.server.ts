import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { Bindings } from "../env";
import { HttpError } from "../lib/security";
import {
	type JobRow,
	publicJob,
	requireGenerationSchema,
} from "./store.server";
const reconcileSchema = z
	.object({
		outcome: z.enum(["charged", "released"]),
		reason: z.string().trim().min(20).max(1000),
		providerInspectionConfirmed: z.literal(true),
	})
	.strict();
async function requireAdmin(env: Bindings, adminId: string) {
	const admin = await env.DB.prepare(
		"SELECT role,banned,ban_expires FROM user WHERE id=?",
	)
		.bind(adminId)
		.first<{ role: string; banned: number; ban_expires: number | null }>();
	if (
		admin?.role !== "admin" ||
		(admin.banned && (!admin.ban_expires || admin.ban_expires > Date.now()))
	)
		throw new HttpError(403, "Administrator access required.");
}
/** Operator must inspect provider history and confirm processing has ended. Never invokes inference. */
export async function reconcileGeneration(
	env: Bindings,
	adminId: string,
	id: string,
	body: unknown,
) {
	await requireAdmin(env, adminId);
	await requireGenerationSchema(env.DB);
	const input = reconcileSchema.parse(body);
	const now = Date.now();
	const auditId = crypto.randomUUID();
	// UPDATE/INSERT are one D1 transaction. The audit ID marks this exact settlement;
	// no check-then-write race can settle a job that another poll already completed.
	const result = await env.DB.batch([
		env.DB.prepare(`UPDATE generation_jobs SET status='failed',billing_state=?,error_code=?,poll_token=?,updated_at=?
      WHERE id=? AND billing_state='reserved' AND status IN ('unknown','dispatching','queued','processing') AND updated_at<? AND poll_after<=? AND (poll_token IS NULL OR poll_token NOT LIKE 'save:%')`).bind(
			input.outcome,
			input.outcome === "charged" ? "manually_charged" : "manually_released",
			auditId,
			now,
			id,
			now - 300000,
			now,
		),
		env.DB.prepare(
			"INSERT INTO generation_reconciliations(id,job_id,admin_id,outcome,reason,created_at) SELECT ?,id,?,?,?,? FROM generation_jobs WHERE id=? AND poll_token=?",
		).bind(auditId, adminId, input.outcome, input.reason, now, id, auditId),
		env.DB.prepare(
			"UPDATE generation_jobs SET poll_token=NULL WHERE id=? AND poll_token=?",
		).bind(id, auditId),
	]);
	if (!result[0].meta.changes)
		throw new HttpError(
			409,
			"This request cannot be reconciled online. Stop polling and wait at least five minutes; unresolved storage-write locks require offline operator recovery.",
		);
	const row = await env.DB.prepare("SELECT * FROM generation_jobs WHERE id=?")
		.bind(id)
		.first<JobRow>();
	return { job: publicJob(row as JobRow) };
}
export async function listUnresolvedGenerations(
	env: Bindings,
	adminId: string,
) {
	await requireAdmin(env, adminId);
	await requireGenerationSchema(env.DB);
	const result = await env.DB.prepare(
		"SELECT * FROM generation_jobs WHERE billing_state='reserved' ORDER BY created_at ASC LIMIT 100",
	).all<JobRow>();
	return {
		jobs: result.results.map((row) => ({
			...publicJob(row),
			userId: row.user_id,
			providerRequestId: row.provider_request_id,
		})),
		limit: 100,
	};
}
