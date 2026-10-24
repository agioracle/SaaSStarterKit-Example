import "@tanstack/react-start/server-only";
import { tryGetCurrentAuthEndpointContext } from "@better-auth/core/context";

export const VERIFICATION_RESEND_COOLDOWN_MS = 60_000;
export const VERIFICATION_RESEND_ATTEMPT_WINDOW_MS = 60_000;
export const VERIFICATION_RESEND_MAX_ATTEMPTS = 5;
// The mail adapter makes at most three 30-second attempts. A longer lease also
// recovers abandoned Worker requests without leaving an address locked forever.
export const VERIFICATION_RESEND_LEASE_MS = 5 * 60_000;

async function emailDigest(email: string): Promise<string> {
	const bytes = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(email.trim().toLowerCase()),
	);
	return Array.from(new Uint8Array(bytes), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

/**
 * One bounded resend operation, including the mail adapter's internal retries.
 * The existing rate_limit table is shared only as storage: these namespaced
 * rows store expiry times in last_request, so Better Auth's expired-row pruning
 * cannot remove a live reservation or attempt budget. No raw email is stored.
 *
 * Limit hits intentionally resolve without sending. Better Auth returns the
 * same success response for unknown/already-verified accounts; a per-address
 * 429 here would undo that protection. Keep its separate per-IP attempt limit.
 */
export async function withVerificationResendCooldown(
	db: D1Database,
	email: string,
	send: () => Promise<void>,
	now: () => number = Date.now,
): Promise<void> {
	const digest = await emailDigest(email);
	const key = `auth:verification:cooldown:${digest}`;
	const attemptKey = `auth:verification:attempts:${digest}`;
	const owner = crypto.randomUUID();
	const startedAt = now();
	// Atomic UPSERT, not read-then-write: only one Worker owns the delivery lease.
	const reservation = await db
		.prepare(
			`INSERT INTO rate_limit (id, key, count, last_request)
			 VALUES (?, ?, 1, ?)
			 ON CONFLICT(key) DO UPDATE SET
			   id=excluded.id, count=1, last_request=excluded.last_request
			 WHERE rate_limit.last_request<=?
			 RETURNING id`,
		)
		.bind(owner, key, startedAt + VERIFICATION_RESEND_LEASE_MS, startedAt)
		.first<{ id: string }>();
	if (!reservation) return;

	const release = () =>
		db
			.prepare("DELETE FROM rate_limit WHERE key=? AND id=? AND count=1")
			.bind(key, owner)
			.run();
	try {
		// Failures release the delivery lease, not this independent abuse budget.
		const attempt = await db
			.prepare(
				`INSERT INTO rate_limit (id, key, count, last_request)
				 VALUES (?, ?, 1, ?)
				 ON CONFLICT(key) DO UPDATE SET
				   count=CASE WHEN rate_limit.last_request<=? THEN 1 ELSE rate_limit.count+1 END,
				   last_request=CASE WHEN rate_limit.last_request<=? THEN excluded.last_request ELSE rate_limit.last_request END
				 WHERE rate_limit.last_request<=? OR rate_limit.count<?
				 RETURNING count`,
			)
			.bind(
				crypto.randomUUID(),
				attemptKey,
				startedAt + VERIFICATION_RESEND_ATTEMPT_WINDOW_MS,
				startedAt,
				startedAt,
				startedAt,
				VERIFICATION_RESEND_MAX_ATTEMPTS,
			)
			.first<{ count: number }>();
		if (!attempt) {
			await release();
			return;
		}
		await send();
	} catch (error) {
		// A stale owner must never delete a replacement lease or its cooldown.
		await release();
		throw error;
	}

	// Delivery succeeded. Start the cooldown from acceptance, not request start.
	// Deliberately outside the catch: if finalization fails, retain the lease
	// rather than permit a second send after an already accepted delivery.
	await db
		.prepare(
			"UPDATE rate_limit SET count=0, last_request=? WHERE key=? AND id=? AND count=1",
		)
		.bind(now() + VERIFICATION_RESEND_COOLDOWN_MS, key, owner)
		.run();
}

/** Apply resend policy without changing signup or change-email delivery. */
export async function sendVerificationMailWithCooldown(
	db: D1Database,
	email: string,
	send: () => Promise<void>,
	request?: Request,
): Promise<void> {
	// The public Better Auth endpoint context also covers auth.api calls that
	// have no Request. Prefer it to the URL, whose base path is configurable.
	const path =
		tryGetCurrentAuthEndpointContext()?.path ??
		(request ? new URL(request.url).pathname.replace(/\/+$/, "") : undefined);
	if (path !== undefined && !path.endsWith("/send-verification-email")) {
		await send();
		return;
	}
	// Unknown context is conservative: do not accidentally bypass the guard.
	await withVerificationResendCooldown(db, email, send);
}
