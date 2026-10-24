import { HttpError } from "../lib/security";
import { logDiagnostic } from "../lib/diagnostics";
/** D1 atomic fixed-window limiter. Optional garbage collection is never on the request path. */
export async function rateLimit(
	db: D1Database,
	key: string,
	max: number,
	windowSeconds: number,
	now = Date.now(),
) {
	if (
		!key ||
		key.length > 256 ||
		!Number.isSafeInteger(max) ||
		max < 1 ||
		!Number.isSafeInteger(windowSeconds) ||
		windowSeconds < 1 ||
		windowSeconds > 86400
	)
		throw new Error("Invalid internal limiter policy.");
	const bucket = Math.floor(now / (windowSeconds * 1000));
	const id = `api:${key}:${bucket}`;
	const row = await db
		.prepare(
			"INSERT INTO rate_limit(id,key,count,last_request) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1,last_request=excluded.last_request RETURNING count",
		)
		.bind(id, id, now)
		.first<{ count: number }>();
	if (!row || row.count > max)
		throw new HttpError(429, "Too many requests. Please try again later.");
}
/** Indexed and bounded maintenance; never deletes Better Auth or verification reservations. */
export async function pruneRateLimits(
	db: D1Database,
	now = Date.now(),
	limit = 100,
) {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
		throw Error("Invalid cleanup batch.");
	try {
		const result = await db
			.prepare(
				"DELETE FROM rate_limit WHERE id IN (SELECT id FROM rate_limit INDEXED BY rate_limit_api_expiry_idx WHERE last_request<? AND key GLOB 'api:*' ORDER BY last_request,id LIMIT ?)",
			)
			.bind(now - 86400000, limit)
			.run();
		return { deleted: result.meta.changes || 0, ok: true };
	} catch (error) {
		logDiagnostic(error, { operation: "maintenance.rate_limit" });
		return { deleted: 0, ok: false };
	}
}
