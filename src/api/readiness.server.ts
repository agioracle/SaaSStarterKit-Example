import "@tanstack/react-start/server-only";
import { authEnvironment, type Bindings } from "../env";
import { websiteConfig } from "../config/website";
import { logDiagnostic, newRequestId } from "../lib/diagnostics";
import { aiPolicyIssue } from "../ai/policy";
import { getMailProvider } from "../mail/index.server";
import { createConfiguredNewsletterProvider } from "../newsletter/index.server";
import { getNotificationProvider } from "../notification/index.server";
import {
	configuredPaymentProviders,
	paymentNamespace,
	paymentRuntime,
} from "./payments.server";
import { checkPaymentNamespace } from "../db/payment-store";
/** Read-only checks. No provider transport, object mutation, namespace adoption, or paid dispatch. */
export async function readiness(env: Bindings) {
	const requestId = newRequestId();
	const checks: Record<string, boolean> = {
		bindings: Boolean(env.DB && env.BUCKET && env.CACHE),
		database: false,
		migrations: false,
		authConfiguration: !websiteConfig.auth.enabled,
		aiPolicy: !aiPolicyIssue(websiteConfig.ai),
	};
	const inspect = async (name: string, fn: () => unknown) => {
		try {
			await fn();
			checks[name] = true;
		} catch (error) {
			checks[name] = false;
			logDiagnostic(error, {
				operation: `readiness.${name.toLowerCase()}`,
				requestId,
			});
		}
	};
	await inspect("database", async () => {
		await env.DB.prepare("SELECT 1").first();
	});
	await inspect("migrations", async () => {
		const names = [
			"user",
			"session",
			"account",
			"verification",
			"userfiles",
			"userfiles_owner_cursor_idx",
			"payment_checkouts",
			"payment_events",
			"payment_references",
			"payment_namespaces",
			"payment_missing_projection_idx",
			"account_deletions",
			"ai_usage_requests",
            "generation_jobs",
            "generation_reconciliations",
            "generation_capacity_day_idx",
            "account_deletion_freezes_generations",
			"rate_limit_api_expiry_idx",
			"account_deletion_freezes_checkouts",
			"account_deletion_freezes_uploads",
		];
		const objects = await env.DB.prepare(
			`SELECT name FROM sqlite_master WHERE name IN (${names.map(() => "?").join(",")})`,
		)
			.bind(...names)
			.all<{ name: string }>();
		if (objects.results.length !== names.length)
			throw Error("Incomplete schema.");
		const columns = await env.DB.prepare(
			"PRAGMA table_info(account_deletions)",
		).all<{ name: string }>();
		if (!columns.results.some((c) => c.name === "lease_until"))
			throw Error("Cleanup migration missing.");
	});
	if (websiteConfig.auth.enabled)
		await inspect("authConfiguration", () => authEnvironment(env));
	if (websiteConfig.auth.enabled && websiteConfig.auth.google)
		checks.googleConfiguration = Boolean(
			env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
		);
	if (websiteConfig.ai.enabled)
		checks.aiProviderConfiguration = Boolean(
			(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_API_TOKEN) ||
				env.FAL_API_KEY ||
				env.FAL_KEY,
		);
	if (websiteConfig.notification.enabled)
		await inspect("notificationConfiguration", () =>
			getNotificationProvider({ env }),
		);
	if (websiteConfig.mail.enable)
		await inspect("mailConfiguration", () => getMailProvider({ env }));
	if (websiteConfig.newsletter.enabled)
		await inspect("newsletterConfiguration", () =>
			createConfiguredNewsletterProvider(env),
		);
	await inspect("paymentConfiguration", async () => {
		for (const provider of configuredPaymentProviders(env)) {
			paymentRuntime(env, provider);
			const ns = await paymentNamespace(env, provider);
			await checkPaymentNamespace(
				env.DB,
				provider,
				ns.mode,
				ns.account,
				ns.deployment,
			);
		}
	});
	const features = {
		aiEnabled: websiteConfig.ai.enabled,
		paymentEnabled: websiteConfig.payment.enabled,
	};
	return {
		status: Object.values(checks).every(Boolean) ? "ready" : "not_ready",
		checks,
		features,
		requestId,
		scope: "local-bindings-schema-and-configuration-only",
	};
}
