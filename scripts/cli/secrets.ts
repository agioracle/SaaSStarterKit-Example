import { readFileSync } from "node:fs";

export const PUBLIC_VARIABLES = new Set([
	"VITE_GITHUB_URL",
	"VITE_X_URL",
	"VITE_SUPPORT_EMAIL",
	"VITE_APP_URL",
	"VITE_BASE_URL",
	"VITE_PAYMENT_PROVIDER",
	"VITE_STRIPE_PRICE_PRO_MONTHLY",
	"VITE_STRIPE_PRICE_PRO_YEARLY",
	"VITE_STRIPE_PRICE_LIFETIME",
	"VITE_CREEM_PRODUCT_PRO_MONTHLY",
	"VITE_CREEM_PRODUCT_PRO_YEARLY",
	"VITE_CREEM_PRODUCT_LIFETIME",
	"VITE_WAFFO_PRODUCT_PRO_MONTHLY",
	"VITE_WAFFO_PRODUCT_PRO_YEARLY",
	"VITE_WAFFO_PRODUCT_LIFETIME",
	"VITE_GOOGLE_ANALYTICS_ID",
	"VITE_UMAMI_WEBSITE_ID",
	"VITE_UMAMI_SCRIPT",
	"VITE_PLAUSIBLE_SCRIPT",
	"VITE_PLAUSIBLE_DOMAIN",
	"VITE_CLARITY_PROJECT_ID",
	"VITE_OPENPANEL_CLIENT_ID",
	"VITE_CRISP_WEBSITE_ID",
]);
export const DEPLOYMENT_VARIABLES = new Set([
	"CLOUDFLARE_ACCOUNT_ID",
	"CLOUDFLARE_API_TOKEN",
]);
export const RUNTIME_VARIABLES = new Set([
	"APP_ENV",
	"MAINTENANCE_ENABLED",
	"APP_URL",
	"BETTER_AUTH_SECRET",
	"GOOGLE_CLIENT_ID",
	"GOOGLE_CLIENT_SECRET",
	"MAIL_FROM_EMAIL",
	"MAIL_FROM",
	"MAIL_SUPPORT_EMAIL",
	"CLOUDFLARE_EMAIL_API_TOKEN",
	"CLOUDFLARE_ACCOUNT_ID",
	"RESEND_API_KEY",
	"RESEND_AUDIENCE_ID",
	"BEEHIIV_API_KEY",
	"BEEHIIV_PUBLICATION_ID",
	"MAILCHEAP_API_KEY",
	"MAILCHEAP_NEWSLETTER_ID",
	"PAYMENT_MODE",
	"PAYMENT_NAMESPACE",
	"PAYMENT_LEGACY_PROVIDERS",
	"PAYMENT_NEW_CHECKOUTS_ENABLED",
	"PAYMENT_HISTORICAL_PLANS",
	"STRIPE_HISTORICAL_PLANS",
	"CREEM_HISTORICAL_PLANS",
	"WAFFO_HISTORICAL_PLANS",
	"STRIPE_API_VERSION",
	"STRIPE_SECRET_KEY",
	"STRIPE_WEBHOOK_SECRET",
	"STRIPE_PRO_MONTHLY_PRICE_ID",
	"STRIPE_PRO_YEARLY_PRICE_ID",
	"STRIPE_LIFETIME_PRICE_ID",
	"CREEM_API_KEY",
	"CREEM_WEBHOOK_SECRET",
	"CREEM_PRO_MONTHLY_PRICE_ID",
	"CREEM_PRO_YEARLY_PRICE_ID",
	"CREEM_LIFETIME_PRICE_ID",
	"WAFFO_MERCHANT_ID",
	"WAFFO_PRIVATE_KEY",
	"WAFFO_STORE_ID",
	"WAFFO_PORTAL_SSO",
	"WAFFO_DEBUG",
	"WAFFO_PRO_MONTHLY_PRICE_ID",
	"WAFFO_PRO_YEARLY_PRICE_ID",
	"WAFFO_LIFETIME_PRICE_ID",
	"CLOUDFLARE_AI_API_TOKEN",
	"CLOUDFLARE_AI_GATEWAY_ID",
	"CLOUDFLARE_WEBSEARCH_BYOK_ALIAS",
	"FAL_API_KEY",
	"FAL_KEY",
	"APIMART_API_KEY",
	"KIE_API_KEY",
	"DISCORD_WEBHOOK_URL",
	"FEISHU_WEBHOOK_URL",
	"FEISHU_WEBHOOK_SECRET",
	"EXTENSION_ORIGINS",
	"GOOGLE_EXTENSION_CLIENT_ID",
]);
export type EnvironmentValues = Record<string, string>;
export function parseEnv(text: string): EnvironmentValues {
	const values: EnvironmentValues = {};
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line || line.startsWith("#")) continue;
		const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
		if (!match)
			throw new Error(
				`Invalid environment assignment on line ${i + 1}. Shell commands and interpolation are not supported.`,
			);
		const [, key, initial] = match;
		if (Object.hasOwn(values, key))
			throw new Error(`Duplicate environment key: ${key}`);
		let value = initial;
		const quote = value[0];
		if (quote === '"' || quote === "'") {
			let body = value.slice(1);
			let end = -1;
			while (end < 0) {
				for (let j = 0; j < body.length; j++) {
					if (body[j] === quote) {
						let slashes = 0;
						for (let k = j - 1; k >= 0 && body[k] === "\\"; k--) slashes++;
						if (slashes % 2 === 0) {
							end = j;
							break;
						}
					}
				}
				if (end < 0) {
					if (++i >= lines.length)
						throw new Error(`Unclosed quoted environment value: ${key}`);
					body += `\n${lines[i]}`;
				}
			}
			if (
				body.slice(end + 1).trim() &&
				!body
					.slice(end + 1)
					.trim()
					.startsWith("#")
			)
				throw new Error(`Unexpected trailing characters for ${key}`);
			value = body.slice(0, end);
			if (quote === '"')
				value = value
					.replace(/\\n/g, "\n")
					.replace(/\\r/g, "\r")
					.replace(/\\"/g, '"')
					.replace(/\\\\/g, "\\");
		} else value = value.replace(/\s+#.*$/, "").trim();
		values[key] = value;
	}
	return values;
}
export function readEnv(path: string): EnvironmentValues {
	try {
		return parseEnv(readFileSync(path, "utf8"));
	} catch (error) {
		if (error instanceof Error && "code" in error)
			throw new Error(
				"Environment file could not be read. Provide --env-file pointing to a local, untracked file.",
			);
		throw error;
	}
}
export function splitEnvironment(values: EnvironmentValues): {
	public: EnvironmentValues;
	runtime: EnvironmentValues;
	deployment: EnvironmentValues;
} {
	const result = {
		public: {} as EnvironmentValues,
		runtime: {} as EnvironmentValues,
		deployment: {} as EnvironmentValues,
	};
	for (const [key, value] of Object.entries(values)) {
		if (
			["MAIL_PROVIDER", "NEWSLETTER_PROVIDER", "PAYMENT_PROVIDER"].includes(key)
		)
			throw new Error(
				`Legacy selector ${key} is no longer supported. Select mail/newsletter in websiteConfig and payment via VITE_PAYMENT_PROVIDER.`,
			);
		if (PUBLIC_VARIABLES.has(key)) {
			result.public[key] = value.trim() ? value : "";
			continue;
		}
		if (!value.trim()) continue;
		if (RUNTIME_VARIABLES.has(key)) {
			result.runtime[key] = value;
			if (key === "CLOUDFLARE_ACCOUNT_ID") result.deployment[key] = value;
		} else if (DEPLOYMENT_VARIABLES.has(key)) result.deployment[key] = value;
		else
			throw new Error(
				`Variable ${key} is not allowlisted. Review scripts/cli/secrets.ts; no variables were transmitted.`,
			);
	}
	if (
		result.runtime.BETTER_AUTH_SECRET &&
		(result.runtime.BETTER_AUTH_SECRET.length < 32 ||
			/replace|change.?me|example|your.?secret|better-auth-secret|fixture|e2e-only|test-only/i.test(
				result.runtime.BETTER_AUTH_SECRET,
			))
	)
		throw new Error(
			"BETTER_AUTH_SECRET must be a non-placeholder secret of at least 32 characters.",
		);
	return result;
}
export function redact(text: string, values: EnvironmentValues): string {
	let output = text;
	for (const value of Object.values(values)
		.filter(Boolean)
		.sort((a, b) => b.length - a.length))
		output = output.split(value).join("[REDACTED]");
	return output;
}
/** Only the minimum OS/tool context is inherited, never the calling shell's app secrets. */
export function childEnvironment(
	base: NodeJS.ProcessEnv,
	additions: EnvironmentValues = {},
): NodeJS.ProcessEnv {
	const result: NodeJS.ProcessEnv = {
		CI: "true",
		WRANGLER_SEND_METRICS: "false",
		NO_COLOR: "1",
	};
	for (const key of [
		"PATH",
		"HOME",
		"USERPROFILE",
		"SYSTEMROOT",
		"TEMP",
		"TMP",
		"TMPDIR",
		"LANG",
		"LC_ALL",
		"XDG_CONFIG_HOME",
	])
		if (base[key]) result[key] = base[key];
	return { ...result, ...additions };
}
