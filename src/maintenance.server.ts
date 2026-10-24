import { pruneGenerationCapacity } from "./generation/store.server";
import "@tanstack/react-start/server-only";
import type { Bindings } from "./env";
import { drainAccountDeletions } from "./auth/deletion.server";
import { pruneRateLimits } from "./api/rate-limit.server";
import { pruneAiUsage } from "./ai/usage.server";
import { websiteConfig } from "./config/website";
import { logDiagnostic } from "./lib/diagnostics";
/** No provider requests; only the deletion manifests explicitly created by user deletion and bounded limiter GC. */
export async function runMaintenance(env: Bindings, now = Date.now()) {
	if (env.MAINTENANCE_ENABLED !== "true") return { enabled: false };
	const cleanup = await drainAccountDeletions(env, now, 2);
	const limiter = await pruneRateLimits(env.DB, now, 100);
	if (cleanup.pending)
		console.warn(
			JSON.stringify({
				event: "maintenance_backlog",
				operation: "maintenance.account_cleanup",
				pending: cleanup.pending,
			}),
		);
	let ai: { expired: number; removed: number } | null = null;
	try {
		ai = await pruneAiUsage(env.DB, websiteConfig.ai.retentionDays, 100, now);
        await pruneGenerationCapacity(env.DB, websiteConfig.ai.retentionDays, now);
	} catch (error) {
		logDiagnostic(error, { operation: "maintenance.ai_usage" });
	}
	return { enabled: true, cleanup, limiter, ai };
}
