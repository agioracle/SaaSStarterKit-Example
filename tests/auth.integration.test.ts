import { authorizeRouteRequest } from "../src/middlewares/auth-middleware";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	createAuth,
	requireAdmin,
	requireUser,
} from "../src/auth/index.server";
import { verifyGoogleExtensionToken } from "../src/auth/extension";
import { websiteConfig } from "../src/config/website";
import { createD1PaymentStore } from "../src/db/payment-store";
import type { Bindings } from "../src/env";
import type { RawEmail } from "../src/mail/types";
import { createConfiguredNewsletterProvider } from "../src/newsletter/index.server";
import type { NewsletterProvider } from "../src/newsletter/types";

vi.mock("@tanstack/react-start/server-only", () => ({}));
const captured = vi.hoisted(() => ({
	mail: [] as RawEmail[],
	subscribe: vi.fn<NewsletterProvider["subscribe"]>(),
}));
vi.mock("../src/mail/index.server", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../src/mail/index.server")>();
	return {
		...actual,
		sendMailFromEnv: vi.fn(async (_env: unknown, message: RawEmail) => {
			captured.mail.push(message);
			return {
				id: `local-mail-${captured.mail.length}`,
				provider: "resend" as const,
				accepted: true as const,
			};
		}),
	};
});

vi.mock("../src/newsletter/index.server", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../src/newsletter/index.server")>();
	return {
		...actual,
		createConfiguredNewsletterProvider: vi.fn(
			(): NewsletterProvider => ({
				getProviderName: () => "resend",
				subscribe: captured.subscribe,
				unsubscribe: vi.fn(async () => true),
				checkSubscribeStatus: vi.fn(async () => false),
			}),
		),
	};
});

const newsletterDefaults = {
	enabled: websiteConfig.newsletter.enabled,
	autoSubscribe: websiteConfig.newsletter.autoSubscribe,
};
const appOrigin = "http://localhost:3000";
// Fixed, deliberately non-production fixtures. No real accounts, keys, or providers are used.
const secret = "local-test-only-2f8b6d9c4a7e1350b8d2a6c9f4e10735";
const password = "Local-fixture-password-123!";
const replacementPassword = "Replacement-fixture-password-456!";
const googleFixture = {
	GOOGLE_CLIENT_ID: "fixture-web-client.apps.googleusercontent.com",
	GOOGLE_CLIENT_SECRET: "fixture-google-client-secret",
	GOOGLE_EXTENSION_CLIENT_ID:
		"fixture-extension-client.apps.googleusercontent.com",
};
type Auth = ReturnType<typeof createAuth>;
function cookieHeaders(response: Response): Headers {
	const cookies = response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0]);
	expect(
		cookies.some((value) => value.startsWith("better-auth.session_token=")),
	).toBe(true);
	return new Headers({ cookie: cookies.join("; "), origin: appOrigin });
}
function mailUrl(to: string, path: string): URL {
	const message = [...captured.mail]
		.reverse()
		.find((value) => value.to === to && value.html?.includes(path));
	expect(message, `Expected a captured ${path} email for ${to}`).toBeDefined();
	const links = [...(message?.html ?? "").matchAll(/href="([^"]+)"/g)];
	const link = links.find((value) => value[1].includes(path));
	expect(link, "Expected a real rendered email action link").toBeDefined();
	return new URL((link?.[1] ?? "").replaceAll("&amp;", "&"));
}

/** Real Better Auth, Drizzle, and local workerd/D1 with all production migrations. */
describe("Better Auth D1 security integration", () => {
	let mf: Miniflare;
	let db: D1Database;
	let env: Bindings;
	let auth: Auth;
	let externalTransport: ReturnType<typeof vi.fn>;

	beforeAll(async () => {
		mf = new Miniflare(
			convertV4MiniflareOptions({
				modules: true,
				script:
					'export default { fetch() { return new Response("local-auth-test"); } };',
				compatibilityDate: "2026-10-01",
				d1Databases: ["DB"],
			}),
		);
		db = (await mf.getD1Database("DB")) as unknown as D1Database;
		const migrationDirectory = fileURLToPath(
			new URL("../drizzle", import.meta.url),
		);
		const migrations = (await readdir(migrationDirectory))
			.filter((name) => name.endsWith(".sql"))
			.sort();
		expect(migrations.length).toBeGreaterThan(0);
		for (const migration of migrations) {
			const source = await readFile(
				`${migrationDirectory}/${migration}`,
				"utf8",
			);
			for (const statement of source
				.split("--> statement-breakpoint")
				.map((value) => value.trim())
				.filter(Boolean))
				await db.prepare(statement).run();
		}
		env = {
			DB: db,
			BUCKET: { delete: vi.fn() } as unknown as R2Bucket,
			CACHE: {
				get: vi.fn(async () => null),
				put: vi.fn(async () => undefined),
				delete: vi.fn(async () => undefined),
			} as unknown as KVNamespace,
			NEWSLETTER_PROVIDER: "resend",
			RESEND_API_KEY: "fixture-resend-newsletter-key",
			APP_ENV: "test",
			APP_URL: appOrigin,
			BETTER_AUTH_SECRET: secret,
		};
	}, 30_000);

	beforeEach(async () => {
		for (const table of [
			"account_deletions",
			"user",
			"verification",
			"rate_limit",
		])
			await db.prepare(`DELETE FROM ${table}`).run();
		captured.mail.length = 0;
		captured.subscribe.mockReset().mockResolvedValue(true);
		vi.mocked(createConfiguredNewsletterProvider).mockClear();
		vi.mocked(env.CACHE.delete).mockClear();
		Object.assign(websiteConfig.newsletter, newsletterDefaults);
		vi.mocked(env.BUCKET.delete).mockClear();
		externalTransport = vi.fn(() => {
			throw new Error(
				"Live provider/network calls are forbidden in auth integration tests",
			);
		});
		vi.stubGlobal("fetch", externalTransport);
		auth = createAuth(env);
	});
	afterEach(() => {
		try {
			expect(externalTransport).not.toHaveBeenCalled();
		} finally {
			Object.assign(websiteConfig.newsletter, newsletterDefaults);
			vi.unstubAllGlobals();
		}
	});
	afterAll(async () => {
		if (mf) await mf.dispose();
	}, 30_000);

	async function signUp(email: string, newsletterConsent?: boolean) {
		return auth.api.signUpEmail({
			body: {
				email,
				password,
				name: "Local Auth User",
				...(newsletterConsent === undefined ? {} : { newsletterConsent }),
			},
			asResponse: true,
		});
	}
	async function verifiedMember(email: string, newsletterConsent?: boolean) {
		const signup = await signUp(email, newsletterConsent);
		expect(signup.status).toBe(200);
		const signupData = (await signup.json()) as {
			user: { id: string; email: string };
		};
		const token = mailUrl(email, "/verify-email").searchParams.get("token");
		expect(token).toBeTruthy();
		const verification = await auth.api.verifyEmail({
			query: { token: token ?? "" },
			asResponse: true,
		});
		expect(verification.status).toBe(200);
		const headers = cookieHeaders(verification);
		return { id: signupData.user.id, email, headers };
	}

	it("public route middleware uses real sessions, enforces admin role and returns a token-free context", async () => {
		const anonymous = await authorizeRouteRequest(
			new Request(`${appOrigin}/settings/profile`),
			env,
		);
		expect(anonymous).toBeInstanceOf(Response);
		if (anonymous instanceof Response) {
			expect(anonymous.status).toBe(307);
			expect(anonymous.headers.get("location")).toContain(
				"/auth/login?redirect=",
			);
		}
		const member = await verifiedMember("route-member@example.test");
		const login = await auth.api.signInEmail({
			body: { email: "route-member@example.test", password },
			asResponse: true,
		});
		const request = new Request(`${appOrigin}/settings/profile`, {
			headers: cookieHeaders(login),
		});
		const result = await authorizeRouteRequest(request, env);
		expect(result).not.toBeInstanceOf(Response);
		if (!(result instanceof Response)) {
			expect(result.user.email).toBe("route-member@example.test");
			expect(result.session).not.toHaveProperty("token");
		}
		expect(
			((await authorizeRouteRequest(request, env, "admin")) as Response).status,
		).toBe(403);
		await db
			.prepare("UPDATE user SET role='admin' WHERE email=?")
			.bind("route-member@example.test")
			.run();
		expect(
			await authorizeRouteRequest(request, env, "admin"),
		).not.toBeInstanceOf(Response);
		void member;
	});
	it("requires email verification, stores a hashed password, and creates a signed session only after verification", async () => {
		const email = "signup@example.test";
		const signup = await signUp(email);
		expect(signup.status).toBe(200);
		const result = (await signup.json()) as {
			token: string | null;
			user: { id: string; emailVerified: boolean; role: string };
		};
		expect(result.token).toBeNull();
		expect(result.user).toMatchObject({ emailVerified: false, role: "user" });
		expect(signup.headers.get("set-cookie")).toBeNull();
		expect(
			await db.prepare("SELECT count(*) FROM session").first("count(*)"),
		).toBe(0);
		const credential = await db
			.prepare("SELECT password FROM account WHERE user_id=? AND provider_id=?")
			.bind(result.user.id, "credential")
			.first<{ password: string }>();
		expect(credential?.password).toBeTruthy();
		expect(credential?.password).not.toBe(password);
		expect(captured.mail).toHaveLength(1);
		expect(captured.mail[0]).toMatchObject({
			to: email,
			subject: "Verify your email address",
		});
		const unverifiedLogin = await auth.api.signInEmail({
			body: { email, password },
			asResponse: true,
		});
		expect(unverifiedLogin.status).toBe(403);
		expect(await unverifiedLogin.json()).toMatchObject({
			code: "EMAIL_NOT_VERIFIED",
		});
		const link = mailUrl(email, "/verify-email");
		const verification = await auth.api.verifyEmail({
			query: { token: link.searchParams.get("token") ?? "" },
			asResponse: true,
		});
		expect(verification.status).toBe(200);
		const login = await auth.api.signInEmail({
			body: { email, password },
			asResponse: true,
		});
		expect(login.status).toBe(200);
		expect(login.headers.get("set-cookie")).toContain("HttpOnly");
		expect(login.headers.get("set-cookie")).toContain("SameSite=Lax");
		const session = await requireUser(
			new Request(`${appOrigin}/api/account`, {
				headers: cookieHeaders(login),
			}),
			env,
		);
		expect(session.user).toMatchObject({
			id: result.user.id,
			email,
			emailVerified: true,
			role: "user",
		});
		expect(
			await db
				.prepare("SELECT email_verified FROM user WHERE id=?")
				.bind(result.user.id)
				.first("email_verified"),
		).toBe(1);
	});

	it.each([undefined, false])(
		"persists newsletter consent as false and does not subscribe when consent is %s",
		async (consent) => {
			Object.assign(websiteConfig.newsletter, {
				enabled: true,
				autoSubscribe: true,
			});
			const member = await verifiedMember(
				"newsletter-no-consent@example.test",
				consent,
			);
			expect(
				await db
					.prepare("SELECT newsletter_consent FROM user WHERE id=?")
					.bind(member.id)
					.first("newsletter_consent"),
			).toBe(0);
			expect(
				(await auth.api.getSession({ headers: member.headers }))?.user
					.newsletterConsent,
			).toBe(false);
			expect(createConfiguredNewsletterProvider).not.toHaveBeenCalled();
			expect(captured.subscribe).not.toHaveBeenCalled();
		},
	);

	it.each([
		{ enabled: false, autoSubscribe: true },
		{ enabled: true, autoSubscribe: false },
	])(
		"does not auto-subscribe with explicit consent when newsletter configuration is %j",
		async (flags) => {
			Object.assign(websiteConfig.newsletter, flags);
			const member = await verifiedMember(
				"newsletter-disabled@example.test",
				true,
			);
			expect(
				await db
					.prepare("SELECT newsletter_consent FROM user WHERE id=?")
					.bind(member.id)
					.first("newsletter_consent"),
			).toBe(1);
			expect(createConfiguredNewsletterProvider).not.toHaveBeenCalled();
			expect(captured.subscribe).not.toHaveBeenCalled();
		},
	);

	it("subscribes an explicitly consenting member exactly once, only after email verification and with both feature flags enabled", async () => {
		Object.assign(websiteConfig.newsletter, {
			enabled: true,
			autoSubscribe: true,
		});
		const email = "newsletter-opted-in@example.test";
		const signup = await signUp(email, true);
		expect(signup.status).toBe(200);
		const signupBody = (await signup.json()) as {
			user: { newsletterConsent: boolean; emailVerified: boolean };
		};
		expect(signupBody.user).toMatchObject({
			newsletterConsent: true,
			emailVerified: false,
		});
		expect(
			await db
				.prepare("SELECT newsletter_consent FROM user WHERE email=?")
				.bind(email)
				.first("newsletter_consent"),
		).toBe(1);
		expect(createConfiguredNewsletterProvider).not.toHaveBeenCalled();
		expect(captured.subscribe).not.toHaveBeenCalled();
		const token =
			mailUrl(email, "/verify-email").searchParams.get("token") ?? "";
		const verified = await auth.api.verifyEmail({
			query: { token },
			asResponse: true,
		});
		expect(verified.status).toBe(200);
		expect(createConfiguredNewsletterProvider).toHaveBeenCalledTimes(1);
		expect(
			vi.mocked(createConfiguredNewsletterProvider).mock.calls[0][0] === env,
		).toBe(true);
		expect(captured.subscribe).toHaveBeenCalledExactlyOnceWith({
			email,
			consent: true,
		});
		// Configured factory cache invalidation is tested through the real provider in config-wiring.test.ts.
		expect(
			(await auth.api.getSession({ headers: cookieHeaders(verified) }))?.user,
		).toMatchObject({ newsletterConsent: true, emailVerified: true });
		// Reusing the email link and later logging in must not subscribe the member again.
		const repeated = await auth.api.verifyEmail({
			query: { token },
			asResponse: true,
		});
		expect(repeated.status).toBe(200);
		const login = await auth.api.signInEmail({
			body: { email, password },
			asResponse: true,
		});
		expect(login.status).toBe(200);
		expect(captured.subscribe).toHaveBeenCalledTimes(1);
	});

	it("keeps verification and sign-in working when the optional newsletter provider fails", async () => {
		Object.assign(websiteConfig.newsletter, {
			enabled: true,
			autoSubscribe: true,
		});
		captured.subscribe.mockRejectedValueOnce(
			new Error("Fixture newsletter provider unavailable"),
		);
		const warning = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		try {
			const member = await verifiedMember(
				"newsletter-provider-failed@example.test",
				true,
			);
			expect(captured.subscribe).toHaveBeenCalledExactlyOnceWith({
				email: member.email,
				consent: true,
			});
			expect(
				await db
					.prepare("SELECT email_verified FROM user WHERE id=?")
					.bind(member.id)
					.first("email_verified"),
			).toBe(1);
			expect(
				(await auth.api.getSession({ headers: member.headers }))?.user,
			).toMatchObject({
				id: member.id,
				emailVerified: true,
				newsletterConsent: true,
			});
			const login = await auth.api.signInEmail({
				body: { email: member.email, password },
				asResponse: true,
			});
			expect(login.status).toBe(200);
			expect(captured.subscribe).toHaveBeenCalledTimes(1);
			expect(warning).toHaveBeenCalledWith(
				"Optional newsletter signup failed; user may retry in settings.",
			);
		} finally {
			warning.mockRestore();
		}
	});

	it("rejects short signup passwords before creating credentials or sending mail", async () => {
		const response = await auth.api.signUpEmail({
			body: {
				email: "short-password@example.test",
				password: "short",
				name: "Local Auth User",
			},
			asResponse: true,
		});
		expect(response.status).toBe(400);
		expect(
			await db.prepare("SELECT count(*) FROM user").first("count(*)"),
		).toBe(0);
		expect(
			await db.prepare("SELECT count(*) FROM account").first("count(*)"),
		).toBe(0);
		expect(captured.mail).toHaveLength(0);
	});

	it("accepts signed bearer sessions but rejects raw, altered, and expired session tokens", async () => {
		const member = await verifiedMember("signed-session@example.test");
		const login = await auth.api.signInEmail({
			body: { email: member.email, password },
			asResponse: true,
		});
		expect(login.status).toBe(200);
		const signedToken = login.headers.get("set-auth-token");
		expect(signedToken).toBeTruthy();
		const body = (await login.json()) as { token: string };
		const signed = await auth.api.getSession({
			headers: new Headers({ authorization: `Bearer ${signedToken}` }),
		});
		expect(signed?.user.id).toBe(member.id);
		expect(
			await auth.api.getSession({
				headers: new Headers({ authorization: `Bearer ${body.token}` }),
			}),
		).toBeNull();
		expect(
			await auth.api.getSession({
				headers: new Headers({
					authorization: `Bearer ${signedToken}tampered`,
				}),
			}),
		).toBeNull();
		await db
			.prepare("UPDATE session SET expires_at=? WHERE user_id=?")
			.bind(Date.now() - 1, member.id)
			.run();
		expect(
			await auth.api.getSession({ headers: cookieHeaders(login) }),
		).toBeNull();
	});

	it("returns the same invalid-credentials response for an unknown account and a wrong password", async () => {
		await verifiedMember("login@example.test");
		const unknown = await auth.api.signInEmail({
			body: { email: "absent@example.test", password },
			asResponse: true,
		});
		const wrongPassword = await auth.api.signInEmail({
			body: { email: "login@example.test", password: replacementPassword },
			asResponse: true,
		});
		expect(unknown.status).toBe(401);
		expect(wrongPassword.status).toBe(unknown.status);
		expect(await wrongPassword.json()).toEqual(await unknown.json());
	});

	it("keeps password-reset responses non-enumerating and consumes the reset token while revoking old sessions", async () => {
		const member = await verifiedMember("reset@example.test");
		const existing = await auth.api.requestPasswordReset({
			body: { email: member.email, redirectTo: `${appOrigin}/reset-password` },
			asResponse: true,
		});
		const unknown = await auth.api.requestPasswordReset({
			body: {
				email: "absent@example.test",
				redirectTo: `${appOrigin}/reset-password`,
			},
			asResponse: true,
		});
		expect(existing.status).toBe(200);
		expect(unknown.status).toBe(existing.status);
		expect(await unknown.json()).toEqual(await existing.json());
		expect(
			captured.mail.filter((value) => value.subject === "Reset your password"),
		).toHaveLength(1);
		const resetLink = mailUrl(member.email, "/reset-password/");
		const token = resetLink.pathname.split("/").at(-1) ?? "";
		const reset = await auth.api.resetPassword({
			body: { token, newPassword: replacementPassword },
			asResponse: true,
		});
		expect(reset.status).toBe(200);
		expect(await auth.api.getSession({ headers: member.headers })).toBeNull();
		const reused = await auth.api.resetPassword({
			body: { token, newPassword: password },
			asResponse: true,
		});
		expect(reused.status).toBe(400);
		expect(await reused.json()).toMatchObject({ code: "INVALID_TOKEN" });
		const oldLogin = await auth.api.signInEmail({
			body: { email: member.email, password },
			asResponse: true,
		});
		expect(oldLogin.status).toBe(401);
		const newLogin = await auth.api.signInEmail({
			body: { email: member.email, password: replacementPassword },
			asResponse: true,
		});
		expect(newLogin.status).toBe(200);
	});

	it("denies member admin operations and permits explicitly promoted administrators", async () => {
		const member = await verifiedMember("member@example.test");
		const admin = await verifiedMember("admin@example.test");
		await db
			.prepare("UPDATE user SET role=? WHERE id=?")
			.bind("admin", admin.id)
			.run();
		const deniedList = await auth.api.listUsers({
			headers: member.headers,
			query: {},
			asResponse: true,
		});
		expect(deniedList.status).toBe(403);
		const deniedRole = await auth.api.setRole({
			headers: member.headers,
			body: { userId: member.id, role: "admin" },
			asResponse: true,
		});
		expect(deniedRole.status).toBe(403);
		expect(
			await db
				.prepare("SELECT role FROM user WHERE id=?")
				.bind(member.id)
				.first("role"),
		).toBe("user");
		await expect(
			requireAdmin(
				new Request(`${appOrigin}/api/admin`, { headers: member.headers }),
				env,
			),
		).rejects.toMatchObject({ status: 403 });
		const adminSession = await requireAdmin(
			new Request(`${appOrigin}/api/admin`, { headers: admin.headers }),
			env,
		);
		expect(adminSession.user.id).toBe(admin.id);
		const allowed = await auth.api.listUsers({
			headers: admin.headers,
			query: {},
			asResponse: true,
		});
		expect(allowed.status).toBe(200);
		expect(await allowed.json()).toMatchObject({ total: 2 });
	});

	it("revokes all existing sessions when an administrator bans a member", async () => {
		const member = await verifiedMember("admin-ban-target@example.test");
		const administrator = await verifiedMember("banning-admin@example.test");
		await db
			.prepare("UPDATE user SET role=? WHERE id=?")
			.bind("admin", administrator.id)
			.run();
		const banned = await auth.api.banUser({
			headers: administrator.headers,
			body: { userId: member.id, banReason: "Local integration suspension" },
			asResponse: true,
		});
		expect(banned.status).toBe(200);
		expect(
			await db
				.prepare("SELECT banned FROM user WHERE id=?")
				.bind(member.id)
				.first("banned"),
		).toBe(1);
		expect(
			await db
				.prepare("SELECT count(*) FROM session WHERE user_id=?")
				.bind(member.id)
				.first("count(*)"),
		).toBe(0);
		expect(await auth.api.getSession({ headers: member.headers })).toBeNull();
		await expect(
			requireUser(
				new Request(`${appOrigin}/api/account`, { headers: member.headers }),
				env,
			),
		).rejects.toMatchObject({ status: 401 });
	});

	it("blocks pre-existing sessions and new sign-ins for banned members", async () => {
		const member = await verifiedMember("banned@example.test");
		await db
			.prepare("UPDATE user SET banned=1,ban_reason=? WHERE id=?")
			.bind("Local test suspension", member.id)
			.run();
		await expect(
			requireUser(
				new Request(`${appOrigin}/api/account`, { headers: member.headers }),
				env,
			),
		).rejects.toMatchObject({ status: 403 });
		const login = await auth.api.signInEmail({
			body: { email: member.email, password },
			asResponse: true,
		});
		expect(login.status).toBe(403);
		expect(await login.json()).toMatchObject({ code: "BANNED_USER" });
		await expect(
			auth.api.createApiKey({
				headers: member.headers,
				body: { name: "Banned member key" },
			}),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		const headers = new Headers(member.headers);
		headers.set("content-type", "application/json");
		const denied = await auth.handler(
			new Request(`${appOrigin}/api/auth/api-key/create`, {
				method: "POST",
				headers,
				body: JSON.stringify({ name: "Banned HTTP key" }),
			}),
		);
		expect(denied.status).toBe(403);
		expect(
			await db
				.prepare("SELECT count(*) FROM apikey WHERE reference_id=?")
				.bind(member.id)
				.first("count(*)"),
		).toBe(0);
	});

	it("isolates API-key ownership, hides the stored key, and makes owner revocation effective", async () => {
		const owner = await verifiedMember("key-owner@example.test");
		const other = await verifiedMember("key-other@example.test");
		const created = await auth.api.createApiKey({
			headers: owner.headers,
			body: { name: "Local integration key" },
		});
		expect(created.referenceId).toBe(owner.id);
		expect(created.key).toMatch(/^ek_/);
		const stored = await db
			.prepare("SELECT key FROM apikey WHERE id=?")
			.bind(created.id)
			.first<{ key: string }>();
		expect(stored?.key).toBeTruthy();
		expect(stored?.key).not.toBe(created.key);
		const ownerKeys = await auth.api.listApiKeys({
			headers: owner.headers,
			query: {},
		});
		expect(ownerKeys.apiKeys.map((value) => value.id)).toContain(created.id);
		expect(JSON.stringify(ownerKeys)).not.toContain(created.key);
		const otherKeys = await auth.api.listApiKeys({
			headers: other.headers,
			query: {},
		});
		expect(otherKeys.apiKeys).toEqual([]);
		const stolenRead = await auth.api.getApiKey({
			headers: other.headers,
			query: { id: created.id },
			asResponse: true,
		});
		expect(stolenRead.status).toBe(404);
		const stolenDelete = await auth.api.deleteApiKey({
			headers: other.headers,
			body: { keyId: created.id },
			asResponse: true,
		});
		expect(stolenDelete.status).toBe(404);
		expect(
			(await auth.api.verifyApiKey({ body: { key: created.key } })).valid,
		).toBe(true);
		expect(
			await auth.api.deleteApiKey({
				headers: owner.headers,
				body: { keyId: created.id },
			}),
		).toEqual({ success: true });
		expect(
			(await auth.api.verifyApiKey({ body: { key: created.key } })).valid,
		).toBe(false);
		expect(
			await db
				.prepare("SELECT count(*) FROM apikey WHERE id=?")
				.bind(created.id)
				.first("count(*)"),
		).toBe(0);
	});

	it.each(["refunded", "disputed"] as const)(
		"requires deletion email proof and definitive cancellation, not just a %s subscription, before removing the account and files",
		async (reversal) => {
			const member = await verifiedMember("delete-subscriber@example.test");
			const store = createD1PaymentStore(db);
			const now = Date.now();
			const checkout = {
				reference: "delete-guard-checkout",
				userId: member.id,
				provider: "stripe" as const,
				plan: {
					id: "pro",
					priceId: "price_fixture",
					kind: "subscription" as const,
					amount: 990,
					currency: "USD",
				},
				createdAt: now,
			};
			await store.createCheckout(checkout);
			const event = {
				provider: "stripe" as const,
				checkoutReference: checkout.reference,
				lookup: { subscriptionId: "sub_delete_guard" },
				occurredAt: now,
			};
			await store.appendEvent({
				...event,
				id: "delete-guard-paid",
				type: "invoice.paid",
				effect: "grant",
				state: "active",
				periodEnd: now + 86400000,
			});
			await store.appendEvent({
				...event,
				occurredAt: now + 1,
				id: "delete-guard-scheduled",
				type: "customer.subscription.updated",
				effect: "sync",
				state: "active",
				cancelAtPeriodEnd: true,
			});
			await db
				.prepare(
					"INSERT INTO userfiles(id,user_id,key,name,content_type,size,created_at) VALUES(?,?,?,?,?,?,?)",
				)
				.bind(
					"delete-file",
					member.id,
					`${member.id}/fixture.png`,
					"fixture.png",
					"image/png",
					32,
					now,
				)
				.run();

			async function requestDeletion() {
				const requested = await auth.api.deleteUser({
					headers: member.headers,
					body: {},
					asResponse: true,
				});
				expect(requested.status).toBe(200);
				expect(await requested.json()).toMatchObject({
					success: true,
					message: "Verification email sent",
				});
				expect(
					await db
						.prepare("SELECT count(*) FROM user WHERE id=?")
						.bind(member.id)
						.first("count(*)"),
				).toBe(1);
				return (
					mailUrl(member.email, "/delete-user/callback").searchParams.get(
						"token",
					) ?? ""
				);
			}
			const firstToken = await requestDeletion();
			expect(env.BUCKET.delete).not.toHaveBeenCalled();
			const active = await auth.api.deleteUser({
				headers: member.headers,
				body: { token: firstToken },
				asResponse: true,
			});
			expect(active.status).toBe(400);
			expect(await active.json()).toMatchObject({
				message: expect.stringContaining("End all recurring subscriptions"),
			});

			// A financial reversal revokes entitlement but does not prove recurring billing ended.
			await store.appendEvent({
				...event,
				occurredAt: now + 2,
				id: `delete-guard-${reversal}`,
				type:
					reversal === "refunded"
						? "charge.refunded"
						: "charge.dispute.created",
				effect: "revoke",
				state: reversal,
			});
			const reversed = await auth.api.deleteUser({
				headers: member.headers,
				body: { token: await requestDeletion() },
				asResponse: true,
			});
			expect(reversed.status).toBe(400);
			expect(env.BUCKET.delete).not.toHaveBeenCalled();

			await store.appendEvent({
				...event,
				occurredAt: now + 3,
				id: "delete-guard-canceled",
				type: "customer.subscription.deleted",
				effect: "revoke",
				state: "canceled",
			});
			const deleted = await auth.api.deleteUser({
				headers: member.headers,
				body: { token: await requestDeletion() },
				asResponse: true,
			});
			expect(deleted.status).toBe(200);
			expect(await deleted.json()).toMatchObject({
				success: true,
				message: "User deleted",
			});
			expect(env.BUCKET.delete).toHaveBeenCalledExactlyOnceWith(
				`${member.id}/fixture.png`,
			);
			expect(await auth.api.getSession({ headers: member.headers })).toBeNull();
			for (const table of [
				"user",
				"account",
				"session",
				"userfiles",
				"payment_checkouts",
				"payment_events",
			])
				expect(
					await db.prepare(`SELECT count(*) FROM ${table}`).first("count(*)"),
				).toBe(0);
		},
	);

	it("rejects an existing session when authentication is globally disabled", async () => {
		const member = await verifiedMember("disabled-auth@example.test");
		const previous = websiteConfig.auth.enabled;
		try {
			Object.assign(websiteConfig.auth, { enabled: false });
			await expect(
				requireUser(
					new Request(`${appOrigin}/api/me`, { headers: member.headers }),
					env,
				),
			).rejects.toMatchObject({ status: 404 });
		} finally {
			Object.assign(websiteConfig.auth, { enabled: previous });
		}
	});

	it("applies the recurring billing deletion guard before admin removal changes any target credentials", async () => {
		const operator = await verifiedMember("operator-delete@example.test");
		const member = await verifiedMember("admin-target@example.test");
		await db
			.prepare("UPDATE user SET role='admin' WHERE id=?")
			.bind(operator.id)
			.run();
		const store = createD1PaymentStore(db);
		await store.createCheckout({
			reference: "admin-open-recurring",
			userId: member.id,
			provider: "stripe",
			plan: {
				id: "pro",
				priceId: "price_local",
				kind: "subscription",
				amount: 990,
				currency: "USD",
			},
			createdAt: Date.now(),
		});
		const response = await auth.handler(
			new Request(`${appOrigin}/api/auth/admin/remove-user`, {
				method: "POST",
				headers: new Headers([
					...operator.headers,
					["content-type", "application/json"],
				]),
				body: JSON.stringify({ userId: member.id }),
			}),
		);
		expect(response.status).toBe(400);
		expect(
			await auth.api.getSession({ headers: member.headers }),
		).not.toBeNull();
		expect(
			await db
				.prepare("SELECT count(*) AS count FROM account WHERE user_id=?")
				.bind(member.id)
				.first("count"),
		).toBe(1);
		expect(
			await db
				.prepare(
					"SELECT count(*) AS count FROM payment_checkouts WHERE user_id=?",
				)
				.bind(member.id)
				.first("count"),
		).toBe(1);
		expect(
			await db
				.prepare(
					"SELECT count(*) AS count FROM account_deletions WHERE user_id=?",
				)
				.bind(member.id)
				.first("count"),
		).toBe(0);
		expect(env.BUCKET.delete).not.toHaveBeenCalled();
	});
	it("keeps an R2 cleanup manifest after admin deletion and retries only after the owner is gone", async () => {
		const operator = await verifiedMember("operator-cleanup@example.test");
		const member = await verifiedMember("cleanup-target@example.test");
		await db
			.prepare("UPDATE user SET role='admin' WHERE id=?")
			.bind(operator.id)
			.run();
		const key = `${member.id}/old.txt`;
		await db
			.prepare(
				"INSERT INTO userfiles(id,user_id,key,name,content_type,size,created_at) VALUES(?,?,?,?,?,?,?)",
			)
			.bind(
				"cleanup-file",
				member.id,
				key,
				"old.txt",
				"text/plain",
				4,
				Date.now(),
			)
			.run();
		vi.mocked(env.BUCKET.delete).mockRejectedValueOnce(
			new Error("fixture storage temporarily unavailable"),
		);
		const response = await auth.handler(
			new Request(`${appOrigin}/api/auth/admin/remove-user`, {
				method: "POST",
				headers: new Headers([
					...operator.headers,
					["content-type", "application/json"],
				]),
				body: JSON.stringify({ userId: member.id }),
			}),
		);
		expect(response.status).toBe(200);
		expect(
			await db
				.prepare("SELECT id FROM user WHERE id=?")
				.bind(member.id)
				.first(),
		).toBeNull();
		expect(
			await db
				.prepare("SELECT file_keys FROM account_deletions WHERE user_id=?")
				.bind(member.id)
				.first("file_keys"),
		).toBe(JSON.stringify([key]));
		const { finishAccountDeletion } = await import(
			"../src/auth/deletion.server"
		);
		expect(await finishAccountDeletion(env, member.id)).toBe("complete");
		expect(
			await db
				.prepare("SELECT user_id FROM account_deletions WHERE user_id=?")
				.bind(member.id)
				.first(),
		).toBeNull();
		expect(await finishAccountDeletion(env, member.id)).toBe("complete");
		expect(env.BUCKET.delete).toHaveBeenCalledTimes(2);
	});
	it("freezes new checkout and upload metadata while deletion is prepared without deleting R2 early", async () => {
		const member = await verifiedMember("freeze-delete@example.test");
		const { prepareAccountDeletion, finishAccountDeletion } = await import(
			"../src/auth/deletion.server"
		);
		await prepareAccountDeletion(env, member.id);
		await prepareAccountDeletion(env, member.id); // DB hook safely revisits the prepared boundary.
		expect(await finishAccountDeletion(env, member.id)).toBe("not-deleted");
		await expect(
			createD1PaymentStore(db).createCheckout({
				reference: "after-lock",
				userId: member.id,
				provider: "stripe",
				plan: {
					id: "pro",
					priceId: "price",
					kind: "subscription",
					amount: 990,
					currency: "USD",
				},
				createdAt: Date.now(),
			}),
		).rejects.toThrow("Account deletion in progress");
		await expect(
			db
				.prepare(
					"INSERT INTO userfiles(id,user_id,key,name,content_type,size,created_at) VALUES(?,?,?,?,?,?,?)",
				)
				.bind(
					"after-lock",
					member.id,
					"blocked-key",
					"a.txt",
					"text/plain",
					1,
					Date.now(),
				)
				.run(),
		).rejects.toThrow("Account deletion in progress");
		expect(env.BUCKET.delete).not.toHaveBeenCalled();
		expect(
			await auth.api.getSession({ headers: member.headers }),
		).not.toBeNull();
	});
	it("fails closed if a schema-only push omitted required deletion triggers", async () => {
		const member = await verifiedMember("missing-trigger@example.test");
		await db.prepare("DROP TRIGGER account_deletion_freezes_uploads").run();
		try {
			const { prepareAccountDeletion } = await import(
				"../src/auth/deletion.server"
			);
			await expect(
				prepareAccountDeletion(env, member.id),
			).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE" });
			expect(
				await db
					.prepare("SELECT id FROM user WHERE id=?")
					.bind(member.id)
					.first(),
			).not.toBeNull();
		} finally {
			await db
				.prepare(
					"CREATE TRIGGER account_deletion_freezes_uploads BEFORE INSERT ON userfiles WHEN EXISTS(SELECT 1 FROM account_deletions WHERE user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT, 'Account deletion in progress'); END",
				)
				.run();
		}
	});

	it.each([
		["failed", true],
		["expired", true],
		["creating", false],
		["open", false],
		["unknown", false],
	] as const)(
		"deletion guard treats %s checkout lifecycle using terminal evidence only",
		async (lifecycle, allowed) => {
			const member = await verifiedMember(
				`lifecycle-${lifecycle}@example.test`,
			);
			const store = createD1PaymentStore(db);
			await store.createCheckout({
				reference: `lifecycle-${lifecycle}`,
				userId: member.id,
				provider: "stripe",
				createdAt: Date.now(),
				lifecycle,
				plan: {
					id: "pro",
					priceId: "price_fixture",
					kind: "subscription",
					interval: "month",
					amount: 990,
					currency: "USD",
				},
			});
			const { prepareAccountDeletion } = await import(
				"../src/auth/deletion.server"
			);
			if (allowed) {
				await prepareAccountDeletion(env, member.id);
				expect(
					await db
						.prepare("SELECT file_keys FROM account_deletions WHERE user_id=?")
						.bind(member.id)
						.first("file_keys"),
				).toBe("[]");
			} else
				await expect(
					prepareAccountDeletion(env, member.id),
				).rejects.toMatchObject({ status: "BAD_REQUEST" });
			expect(env.BUCKET.delete).not.toHaveBeenCalled();
		},
	);

	it("checkpoints large object cleanup across bounded retry requests", async () => {
		const keys = Array.from(
			{ length: 21 },
			(_, index) => `deleted-owner/file-${index}.txt`,
		);
		await db
			.prepare(
				"INSERT INTO account_deletions(user_id,file_keys,created_at) VALUES(?,?,?)",
			)
			.bind("deleted-owner", JSON.stringify(keys), Date.now())
			.run();
		const { finishAccountDeletion } = await import(
			"../src/auth/deletion.server"
		);
		expect(await finishAccountDeletion(env, "deleted-owner")).toBe("pending");
		expect(
			JSON.parse(
				String(
					await db
						.prepare("SELECT file_keys FROM account_deletions WHERE user_id=?")
						.bind("deleted-owner")
						.first("file_keys"),
				),
			),
		).toHaveLength(11);
		expect(await finishAccountDeletion(env, "deleted-owner")).toBe("pending");
		expect(await finishAccountDeletion(env, "deleted-owner")).toBe("complete");
		expect(env.BUCKET.delete).toHaveBeenCalledTimes(21);
	});

	it("never prepares another account deletion for a non-administrator", async () => {
		const actor = await verifiedMember("normal-delete@example.test");
		const target = await verifiedMember("normal-target@example.test");
		const response = await auth.handler(
			new Request(`${appOrigin}/api/auth/admin/remove-user`, {
				method: "POST",
				headers: new Headers([
					...actor.headers,
					["content-type", "application/json"],
				]),
				body: JSON.stringify({ userId: target.id }),
			}),
		);
		expect(response.status).toBe(403);
		expect(
			await db
				.prepare("SELECT count(*) AS count FROM account_deletions")
				.first("count"),
		).toBe(0);
		expect(
			await auth.api.getSession({ headers: target.headers }),
		).not.toBeNull();
	});

	it("rejects hostile and missing browser origins before authenticated mutations", async () => {
		const member = await verifiedMember("csrf@example.test");
		// Better Auth intentionally skips origin checks when NODE_ENV=test. Restore the
		// production default, without bypassing or replacing the real middleware.
		const context = await auth.$context;
		expect(context.options.advanced).not.toHaveProperty(
			"disableOriginCheck",
			true,
		);
		expect(context.skipCSRFCheck).toBe(false);
		context.skipOriginCheck = false;
		for (const origin of ["https://evil.example.test", null]) {
			const headers = new Headers(member.headers);
			headers.set("content-type", "application/json");
			if (origin) headers.set("origin", origin);
			else headers.delete("origin");
			const response = await auth.handler(
				new Request(`${appOrigin}/api/auth/update-user`, {
					method: "POST",
					headers,
					body: JSON.stringify({ name: "Attacker Changed Name" }),
				}),
			);
			expect(response.status).toBe(403);
		}
		expect(
			await db
				.prepare("SELECT name FROM user WHERE id=?")
				.bind(member.id)
				.first("name"),
		).toBe("Local Auth User");
		const allowedHeaders = new Headers(member.headers);
		allowedHeaders.set("content-type", "application/json");
		const allowed = await auth.handler(
			new Request(`${appOrigin}/api/auth/update-user`, {
				method: "POST",
				headers: allowedHeaders,
				body: JSON.stringify({ name: "Owner Changed Name" }),
			}),
		);
		expect(allowed.status).toBe(200);
		expect(
			await db
				.prepare("SELECT name FROM user WHERE id=?")
				.bind(member.id)
				.first("name"),
		).toBe("Owner Changed Name");
	});

	it.each([
		undefined,
		"",
		"too-short",
		"replace-this-with-a-random-secret-at-least-32-characters",
		"change-me-to-a-random-secret-at-least-32-characters",
		"better-auth-secret-12345678901234567890",
		"your-secret-123456789012345678901234567890",
	])(
		"rejects missing, weak, or known placeholder secret %s",
		(invalidSecret) => {
			expect(() =>
				createAuth({ ...env, BETTER_AUTH_SECRET: invalidSecret }),
			).toThrow("BETTER_AUTH_SECRET");
		},
	);

	it("refuses test fixture secrets and HTTP application URLs in production", () => {
		expect(() =>
			createAuth({
				...env,
				APP_ENV: "production",
				APP_URL: "https://app.example.test",
			}),
		).toThrow("Test fixture secrets");
		expect(() =>
			createAuth({
				...env,
				APP_ENV: "production",
				BETTER_AUTH_SECRET:
					"46c013ea08b7d9f22cab65e1903d87f45ba6c928d0e1f7395a2bc8046de01732",
			}),
		).toThrow("HTTPS");
	});

	it("rejects the internal extension sentinel through ordinary Google sign-in without contacting Google", async () => {
		const ordinaryAuth = createAuth({ ...env, ...googleFixture });
		const response = await ordinaryAuth.api.signInSocial({
			body: {
				provider: "google",
				idToken: { token: "verified-extension-profile" },
			},
			asResponse: true,
		});
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "INVALID_TOKEN" });
		expect(externalTransport).not.toHaveBeenCalled();
		expect(
			await db.prepare("SELECT count(*) FROM user").first("count(*)"),
		).toBe(0);
		expect(
			await db.prepare("SELECT count(*) FROM session").first("count(*)"),
		).toBe(0);
	});

	it("creates an extension session only from the profile returned by the upstream verifier", async () => {
		const responses = [
			Response.json({
				aud: googleFixture.GOOGLE_EXTENSION_CLIENT_ID,
				azp: googleFixture.GOOGLE_EXTENSION_CLIENT_ID,
				expires_in: 3600,
				sub: "fixture-google-subject",
			}),
			Response.json({
				sub: "fixture-google-subject",
				email: "extension@example.test",
				email_verified: true,
				name: "Verified Extension User",
			}),
		];
		const upstream = vi.fn<typeof fetch>(async () => {
			const next = responses.shift();
			if (!next) throw new Error("Unexpected fixture Google request");
			return next;
		});
		const profile = await verifyGoogleExtensionToken(
			"fixture-google-access-token",
			googleFixture.GOOGLE_EXTENSION_CLIENT_ID,
			upstream,
		);
		expect(upstream).toHaveBeenCalledTimes(2);
		expect(upstream.mock.calls[0][0]).toBe(
			"https://oauth2.googleapis.com/tokeninfo",
		);
		expect(upstream.mock.calls[1][0]).toBe(
			"https://openidconnect.googleapis.com/v1/userinfo",
		);
		const extensionAuth = createAuth({ ...env, ...googleFixture }, profile);
		const response = await extensionAuth.api.signInSocial({
			body: {
				provider: "google",
				idToken: { token: "verified-extension-profile" },
			},
			asResponse: true,
		});
		expect(response.status).toBe(200);
		const session = await requireUser(
			new Request(`${appOrigin}/api/account`, {
				headers: cookieHeaders(response),
			}),
			env,
		);
		expect(session.user).toMatchObject({
			email: "extension@example.test",
			emailVerified: true,
			name: "Verified Extension User",
		});
		expect(
			await db
				.prepare("SELECT account_id FROM account WHERE provider_id=?")
				.bind("google")
				.first("account_id"),
		).toBe("fixture-google-subject");
	});
});
