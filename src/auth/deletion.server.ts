import "@tanstack/react-start/server-only";
import { logDiagnostic } from "../lib/diagnostics";
import { APIError } from "better-auth/api";
import { createD1PaymentStore } from "../db/payment-store";
import {
	foldPaymentEvents,
	isCheckoutTerminalWithoutSubscription,
} from "../payment/entitlements";
import type { Bindings } from "../env";

/** A durable, resumable boundary shared by every Better Auth deletion entry point.
 * D1 freezes new checkouts/uploads before checking recurring billing. R2 is cleaned
 * only after the database deletion succeeds; its manifest deliberately has no FK.
 */
export async function prepareAccountDeletion(env: Bindings, userId: string) {
	const triggers = await env.DB.prepare(
		"SELECT count(*) AS count FROM sqlite_master WHERE type='trigger' AND name IN ('account_deletion_freezes_checkouts','account_deletion_freezes_uploads','account_deletion_freezes_generations')",
	).first<number>("count");
	if (triggers !== 3)
		throw new APIError("SERVICE_UNAVAILABLE", {
			message: "Account deletion requires the current database migrations.",
		});

	const exists = await env.DB.prepare("SELECT id FROM user WHERE id=?")
		.bind(userId)
		.first();
	if (!exists) return;
	const reservation = await env.DB.prepare(
		"INSERT OR IGNORE INTO account_deletions(user_id,file_keys,created_at) VALUES(?,NULL,?)",
	)
		.bind(userId, Date.now())
		.run();
	if (!reservation.meta.changes) {
		const existing = await env.DB.prepare(
			"SELECT file_keys FROM account_deletions WHERE user_id=?",
		)
			.bind(userId)
			.first<{ file_keys: string | null }>();
		if (existing?.file_keys !== null && existing?.file_keys !== undefined)
			return;
		throw new APIError("CONFLICT", {
			message:
				"Account deletion is already being prepared. Ask an administrator to recover an interrupted preparation.",
		});
	}
	try {
        const active = await env.DB.prepare("SELECT id FROM generation_jobs WHERE user_id=? AND (billing_state='reserved' OR status='deleting') LIMIT 1").bind(userId).first();
        if (active) throw new APIError("BAD_REQUEST", { message: "Resolve pending or uncertain image generations before deleting your account. Ask an administrator to reconcile uncertain provider outcomes." });
        const store = createD1PaymentStore(env.DB);
		for (const checkout of await store.listCheckouts(userId)) {
			if (checkout.plan.kind !== "subscription") continue;
			const events = await store.listEvents(
				checkout.provider,
				checkout.reference,
			);
			const current = foldPaymentEvents(checkout, events);
			const ended =
				isCheckoutTerminalWithoutSubscription(current) ||
				(current.references.subscriptionId &&
					events.some(
						(event) =>
							event.effect === "revoke" &&
							event.state === "canceled" &&
							event.lookup.subscriptionId === current.references.subscriptionId,
					));
			// An open checkout may still become a recurring subscription after this request.
			// Financial refunds/disputes and scheduled cancellations are not terminal proof.
			if (!ended)
				throw new APIError("BAD_REQUEST", {
					message:
						"End all recurring subscriptions in billing before deleting your account. Open recurring checkouts must also be resolved; refunds or scheduled cancellation are not final cancellation.",
				});
		}
		const files = await env.DB.prepare(
			"SELECT key FROM userfiles WHERE user_id=? UNION SELECT object_key AS key FROM generation_jobs WHERE user_id=?",
		)
			.bind(userId, userId)
			.all<{ key: string }>();
		await env.DB.prepare(
			"UPDATE account_deletions SET file_keys=? WHERE user_id=?",
		)
			.bind(JSON.stringify(files.results.map((file) => file.key)), userId)
			.run();
	} catch (error) {
		await env.DB.prepare("DELETE FROM account_deletions WHERE user_id=?")
			.bind(userId)
			.run();
		throw error;
	}
}

/** Idempotent, leased and bounded retry. Never deletes objects while owner still exists. */
export async function finishAccountDeletion(
	env: Bindings,
	userId: string,
	now = Date.now(),
): Promise<"complete" | "pending" | "not-deleted"> {
	if (
		await env.DB.prepare("SELECT id FROM user WHERE id=?").bind(userId).first()
	)
		return "not-deleted";
	const exists = await env.DB.prepare(
		"SELECT file_keys FROM account_deletions WHERE user_id=?",
	)
		.bind(userId)
		.first<{ file_keys: string | null }>();
	if (!exists) return "complete";
	if (exists.file_keys === null) return "pending";
	const owner = crypto.randomUUID();
	const row = await env.DB.prepare(
		"UPDATE account_deletions SET lease_id=?,lease_until=? WHERE user_id=? AND lease_until<=? RETURNING file_keys,attempts",
	)
		.bind(owner, now + 300000, userId, now)
		.first<{ file_keys: string; attempts: number }>();
	if (!row) return "pending";
	try {
		const keys = JSON.parse(row.file_keys) as string[];
		if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string"))
			throw Error("Invalid cleanup manifest.");
		for (let removed = 0; keys.length && removed < 10; removed++) {
			await env.BUCKET.delete(keys[0]);
			keys.shift();
			const updated = await env.DB.prepare(
				"UPDATE account_deletions SET file_keys=? WHERE user_id=? AND lease_id=?",
			)
				.bind(JSON.stringify(keys), userId, owner)
				.run();
			if (!updated.meta.changes) return "pending";
		}
		if (keys.length) {
			await env.DB.prepare(
				"UPDATE account_deletions SET lease_id=NULL,lease_until=0,next_attempt_at=?,last_error_code=NULL WHERE user_id=? AND lease_id=?",
			)
				.bind(now + 1000, userId, owner)
				.run();
			return "pending";
		}
		await env.DB.prepare(
			"DELETE FROM account_deletions WHERE user_id=? AND lease_id=?",
		)
			.bind(userId, owner)
			.run();
		return "complete";
	} catch (error) {
		logDiagnostic(error, { operation: "maintenance.account_cleanup" });
		const attempts = Math.min(30, row.attempts + 1);
		const delay = Math.min(86400000, 60000 * 2 ** Math.min(attempts - 1, 10));
		await env.DB.prepare(
			"UPDATE account_deletions SET attempts=?,next_attempt_at=?,lease_id=NULL,lease_until=0,last_error_code='STORAGE_CLEANUP_FAILED' WHERE user_id=? AND lease_id=?",
		)
			.bind(attempts, now + delay, userId, owner)
			.run();
		return "pending";
	}
}
export async function drainAccountDeletions(
	env: Bindings,
	now = Date.now(),
	limit = 2,
) {
	if (!Number.isInteger(limit) || limit < 1 || limit > 5)
		throw Error("Invalid cleanup batch.");
	const rows = await env.DB.prepare(
		"SELECT d.user_id FROM account_deletions d WHERE d.file_keys IS NOT NULL AND d.next_attempt_at<=? AND d.lease_until<=? AND NOT EXISTS(SELECT 1 FROM user u WHERE u.id=d.user_id) ORDER BY d.next_attempt_at,d.user_id LIMIT ?",
	)
		.bind(now, now, limit)
		.all<{ user_id: string }>();
	const result = { attempted: 0, completed: 0, pending: 0 };
	for (const row of rows.results) {
		result.attempted++;
		try {
			const status = await finishAccountDeletion(env, row.user_id, now);
			if (status === "complete") result.completed++;
			else result.pending++;
		} catch (error) {
			result.pending++;
			logDiagnostic(error, { operation: "maintenance.account_cleanup" });
		}
	}
	return result;
}
