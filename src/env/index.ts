import { z } from "zod";
export interface Bindings {
	DB: D1Database;
	BUCKET: R2Bucket;
	CACHE: KVNamespace;
	APP_ENV?: string;
	APP_URL?: string;
	BETTER_AUTH_SECRET?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	[key: string]: unknown;
}
const schema = z.object({
	APP_ENV: z.enum(["development", "test", "production"]).default("development"),
	APP_URL: z.url().default("http://localhost:3000"),
});
export function publicEnvironment(env: Pick<Bindings, "APP_ENV" | "APP_URL">) {
	return schema.parse(env);
}
export function authEnvironment(env: Bindings) {
	const config = publicEnvironment(env);
	const secret = env.BETTER_AUTH_SECRET;
	if (
		!secret ||
		secret.length < 32 ||
		/replace|change.?me|example|your.?secret|better-auth-secret/i.test(secret)
	)
		throw new Error(
			"BETTER_AUTH_SECRET must be a non-placeholder secret of at least 32 characters.",
		);
	if (
		config.APP_ENV === "production" &&
		/fixture|e2e-only|test-only/i.test(secret)
	)
		throw new Error("Test fixture secrets are forbidden in production.");
	if (config.APP_ENV === "production" && !config.APP_URL.startsWith("https://"))
		throw new Error("Production APP_URL must use HTTPS.");
	return { ...config, secret };
}
export function requiredString(env: Bindings, key: string) {
	const value = env[key];
	if (typeof value !== "string" || !value.trim())
		throw new Error(`Missing runtime configuration: ${key}`);
	return value;
}
