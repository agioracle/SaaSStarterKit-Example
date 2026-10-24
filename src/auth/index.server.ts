import {
	APIError,
	createAuthMiddleware,
	getSessionFromCtx,
} from "better-auth/api";
import {
	prepareAccountDeletion,
	finishAccountDeletion,
} from "./deletion.server";
import { sendVerificationMailWithCooldown } from "./verification-mail.server";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { apiKey } from "@better-auth/api-key";
import { admin, bearer } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { authEnvironment, type Bindings } from "../env";
import { websiteConfig } from "../config/website";
import { createConfiguredNewsletterProvider } from "../newsletter/index.server";
import { extensionOrigins, type ExtensionProfile } from "./extension";
import { HttpError } from "../lib/security";
import { sendMailFromEnv, renderAuthEmail } from "../mail/index.server";
export function createAuth(env: Bindings, extensionProfile?: ExtensionProfile) {
	const config = authEnvironment(env);
	const subscribeIfConsented = async (member: {
		email: string;
		newsletterConsent?: boolean;
	}) => {
		if (
			!websiteConfig.newsletter.enabled ||
			!websiteConfig.newsletter.autoSubscribe ||
			member.newsletterConsent !== true
		)
			return;
		try {
			const provider = createConfiguredNewsletterProvider(env);
			await provider.subscribe({ email: member.email, consent: true });
		} catch {
			console.error(
				"Optional newsletter signup failed; user may retry in settings.",
			);
		}
	};
	const mail = async (
		to: string,
		name: string,
		url: string,
		kind: "verify" | "reset" | "delete",
	) => {
		const rendered = await renderAuthEmail({ type: kind, name, url });
		let lastError: unknown;
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				await sendMailFromEnv(env, {
					to,
					...rendered,
					idempotencyKey: `auth:${kind}:${await digest(url)}`,
				});
				return;
			} catch (error) {
				lastError = error;
				if (attempt < 2)
					await new Promise((resolve) => setTimeout(resolve, 250));
			}
		}
		throw lastError;
	};
	return betterAuth({
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path === "/sign-out") return;
				// The admin plugin deletes sessions/accounts before invoking user DB hooks.
				// Guard it before those destructive side effects as well as at DB deletion.
				if (ctx.path === "/admin/remove-user") {
					const actor = await getSessionFromCtx(ctx);
					if (actor?.user.role !== "admin")
						throw new APIError("FORBIDDEN", {
							message: "Administrator access required.",
						});
					const target = ctx.body?.userId;
					if (typeof target !== "string" || !target || target === actor.user.id)
						throw new APIError("BAD_REQUEST", {
							message: "Choose another account to remove.",
						});
					if (!websiteConfig.auth.deleteUser)
						throw new APIError("FORBIDDEN", {
							message: "Account deletion is disabled.",
						});
					if (
						actor.user.banned &&
						(!actor.user.banExpires || actor.user.banExpires > new Date())
					)
						throw new APIError("FORBIDDEN", { message: "Account suspended." });
					await prepareAccountDeletion(env, target);
				}
				if (
					ctx.path.startsWith("/api-key/") ||
					ctx.path.startsWith("/admin/") ||
					[
						"/update-user",
						"/change-password",
						"/delete-user",
						"/list-sessions",
						"/revoke-session",
						"/revoke-sessions",
						"/revoke-other-sessions",
						"/change-email",
					].includes(ctx.path)
				) {
					const current = await getSessionFromCtx(ctx);
					const member = current?.user as
						| { banned?: boolean; banExpires?: Date | null }
						| undefined;
					if (
						member?.banned &&
						(!member.banExpires || member.banExpires > new Date())
					)
						throw new APIError("FORBIDDEN", { message: "Account suspended." });
				}
			}),
		},
		databaseHooks: {
			user: {
				delete: {
					before: async (user) => {
						await prepareAccountDeletion(env, user.id);
					},
					after: async (user) => {
						await finishAccountDeletion(env, user.id);
					},
				},
			},
		},
		logger: {
			level: "error",
			log: (level) => {
				console.error("Authentication operation failed", { level });
			},
		},
		appName: websiteConfig.name,
		baseURL: config.APP_URL,
		secret: config.secret,
		trustedOrigins: [
			config.APP_URL,
			...extensionOrigins(env.EXTENSION_ORIGINS),
		],
		database: drizzleAdapter(getDb(env.DB), {
			provider: "sqlite",
			schema,
			transaction: false,
		}),
		emailAndPassword: {
			enabled: websiteConfig.auth.credentials,
			requireEmailVerification: true,
			minPasswordLength: 10,
			revokeSessionsOnPasswordReset: true,
			sendResetPassword: async ({ user, url }) =>
				mail(user.email, user.name, url, "reset"),
		},
		emailVerification: {
			sendOnSignUp: true,
			sendOnSignIn: false,
			autoSignInAfterVerification: true,
			sendVerificationEmail: async ({ user, url }, request) =>
				sendVerificationMailWithCooldown(
					env.DB,
					user.email,
					() => mail(user.email, user.name, url, "verify"),
					request,
				),
			afterEmailVerification: async (user) =>
				subscribeIfConsented(
					user as typeof user & { newsletterConsent?: boolean },
				),
		},
		socialProviders:
			websiteConfig.auth.google &&
			env.GOOGLE_CLIENT_ID &&
			env.GOOGLE_CLIENT_SECRET
				? {
						google: {
							clientId: env.GOOGLE_CLIENT_ID,
							clientSecret: env.GOOGLE_CLIENT_SECRET,
							...(extensionProfile
								? {
										verifyIdToken: async (token: string) =>
											token === "verified-extension-profile",
										getUserInfo: async () => ({
											user: {
												name: extensionProfile.name,
												email: extensionProfile.email,
												emailVerified: true,
												image: extensionProfile.picture,
											},
											data: {
												...extensionProfile,
												aud: String(env.GOOGLE_EXTENSION_CLIENT_ID),
												azp: String(env.GOOGLE_EXTENSION_CLIENT_ID),
												exp: 0,
												iat: 0,
												iss: "https://accounts.google.com",
												family_name: "",
												given_name: "",
												locale: "en",
												picture: extensionProfile.picture || "",
											},
										}),
									}
								: {}),
						},
					}
				: {},
		user: {
			additionalFields: {
				newsletterConsent: {
					type: "boolean",
					required: false,
					defaultValue: false,
					input: true,
				},
			},
			deleteUser: {
				enabled: websiteConfig.auth.deleteUser,
				sendDeleteAccountVerification: async ({ user, url }) =>
					mail(user.email, user.name, url, "delete"),
				beforeDelete: async (user) => prepareAccountDeletion(env, user.id),
			},
		},
		session: {
			expiresIn: 60 * 60 * 24 * 7,
			updateAge: 60 * 60 * 24,
			cookieCache: { enabled: false },
		},
		rateLimit: {
			enabled: true,
			storage: "database",
			window: 60,
			max: 100,
			customRules: {
				"/sign-in/email": { window: 60, max: 10 },
				"/sign-up/email": { window: 60, max: 5 },
				"/send-verification-email": { window: 60, max: 10 },
				"/request-password-reset": { window: 60, max: 3 },
			},
		},
		advanced: {
			useSecureCookies: config.APP_ENV === "production",
			ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
		},
		plugins: [
			bearer({ requireSignature: true }),
			admin({ defaultRole: "user", adminRoles: ["admin"] }),
			apiKey({
				defaultPrefix: "ek_",
				requireName: true,
				enableMetadata: false,
				rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 60 },
			}),
			tanstackStartCookies(),
		],
	});
}
export async function requireUser(request: Request, env: Bindings) {
	if (!websiteConfig.auth.enabled)
		throw new HttpError(404, "Authentication disabled.");
	const session = await createAuth(env).api.getSession({
		headers: request.headers,
	});
	if (!session) throw new HttpError(401, "Sign in required.");
	if (
		session.user.banned &&
		(!session.user.banExpires || session.user.banExpires > new Date())
	)
		throw new HttpError(403, "Account suspended.");
	return session;
}
export async function requireAdmin(request: Request, env: Bindings) {
	const session = await requireUser(request, env);
	if (session.user.role !== "admin")
		throw new HttpError(403, "Administrator access required.");
	return session;
}

async function digest(value: string) {
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return Array.from(new Uint8Array(hash), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}
