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
import { createAuth } from "../src/auth/index.server";
import {
	sendVerificationMailWithCooldown,
	VERIFICATION_RESEND_ATTEMPT_WINDOW_MS,
	VERIFICATION_RESEND_COOLDOWN_MS,
	VERIFICATION_RESEND_LEASE_MS,
	VERIFICATION_RESEND_MAX_ATTEMPTS,
	withVerificationResendCooldown,
} from "../src/auth/verification-mail.server";
import type { Bindings } from "../src/env";
import type { RawEmail } from "../src/mail/types";

vi.mock("@tanstack/react-start/server-only", () => ({}));
const captured = vi.hoisted(() => ({
	send: vi.fn<(message: RawEmail) => Promise<void>>(),
}));
vi.mock("../src/mail/index.server", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../src/mail/index.server")>();
	return {
		...actual,
		sendMailFromEnv: async (_env: unknown, message: RawEmail) => {
			await captured.send(message);
			return {
				id: "local-verification-fixture",
				provider: "resend" as const,
				accepted: true as const,
			};
		},
	};
});

const origin = "http://localhost:3000";
const email = "verification-fixture@example.test";
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("verification resend cooldown on real local D1", () => {
	let mf: Miniflare;
	let db: D1Database;
	let auth: ReturnType<typeof createAuth>;
	let externalTransport: ReturnType<typeof vi.fn>;
	let time: number;
	const now = () => time;

	beforeAll(async () => {
		mf = new Miniflare(
			convertV4MiniflareOptions({
				modules: true,
				script:
					'export default { fetch() { return new Response("local-verification-test"); } };',
				compatibilityDate: "2026-10-01",
				d1Databases: ["DB"],
			}),
		);
		db = (await mf.getD1Database("DB")) as unknown as D1Database;
		const directory = fileURLToPath(new URL("../drizzle", import.meta.url));
		const migrations = (await readdir(directory))
			.filter((name) => name.endsWith(".sql"))
			.sort();
		for (const migration of migrations) {
			const source = await readFile(`${directory}/${migration}`, "utf8");
			for (const statement of source
				.split("--> statement-breakpoint")
				.map((value) => value.trim())
				.filter(Boolean))
				await db.prepare(statement).run();
		}
	}, 30_000);
	beforeEach(async () => {
		await db.prepare("DELETE FROM user").run();
		await db.prepare("DELETE FROM verification").run();
		await db.prepare("DELETE FROM rate_limit").run();
		time = Date.now();
		captured.send.mockReset().mockResolvedValue();
		externalTransport = vi.fn(() => {
			throw new Error("Live network is forbidden in local verification tests");
		});
		vi.stubGlobal("fetch", externalTransport);
		auth = createAuth({
			DB: db,
			BUCKET: { delete: vi.fn() } as unknown as R2Bucket,
			APP_ENV: "test",
			APP_URL: origin,
			BETTER_AUTH_SECRET:
				"local-test-only-c0d2b7a5f946e381a12d4c6e8f0b3759",
		} as Bindings);
	});
	afterEach(() => {
		try {
			expect(externalTransport).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});
	afterAll(async () => {
		if (mf) await mf.dispose();
	}, 30_000);

	async function signUp() {
		const response = await auth.api.signUpEmail({
			body: {
				email,
				name: "Verification Fixture",
				password: "Local-fixture-password-123!",
			},
			asResponse: true,
		});
		expect(response.status).toBe(200);
		expect(captured.send).toHaveBeenCalledTimes(1);
		captured.send.mockClear();
	}
	function resend(address = email, ip = "192.0.2.50") {
		return auth.handler(
			new Request(`${origin}/api/auth/send-verification-email`, {
				method: "POST",
				headers: {
					origin,
					"content-type": "application/json",
					"cf-connecting-ip": ip,
				},
				body: JSON.stringify({ email: address, callbackURL: "/dashboard" }),
			}),
		);
	}
	function cooldownRows() {
		return db
			.prepare("SELECT * FROM rate_limit WHERE key LIKE ?")
			.bind("auth:verification:cooldown:%")
			.all<{ id: string; key: string; count: number; last_request: number }>();
	}

	it("releases failed rendering/delivery immediately without refunding the independent attempt budget", async () => {
		const failure = new Error("local rendering or delivery fixture failed");
		const send = vi.fn<() => Promise<void>>().mockRejectedValueOnce(failure);
		await expect(
			withVerificationResendCooldown(db, email, send, now),
		).rejects.toBe(failure);
		expect((await cooldownRows()).results).toEqual([]);
		send.mockResolvedValue();
		await withVerificationResendCooldown(db, email, send, now);
		expect(send).toHaveBeenCalledTimes(2);
		const rows = await db.prepare("SELECT key, count FROM rate_limit").all<{
			key: string;
			count: number;
		}>();
		expect(rows.results).toHaveLength(2);
		for (const row of rows.results) {
			expect(row.key).toMatch(/^auth:verification:(cooldown|attempts):[a-f0-9]{64}$/);
			expect(row.key).not.toContain(email);
		}
		expect(rows.results.find((row) => row.key.includes(":attempts:"))?.count).toBe(2);
	});

	it("starts the exact 60-second cooldown at successful acceptance and normalizes email keys", async () => {
		const send = vi.fn(async () => {
			time += 20_000;
		});
		await withVerificationResendCooldown(db, `  ${email.toUpperCase()}  `, send, now);
		const acceptedAt = time;
		time = acceptedAt + VERIFICATION_RESEND_COOLDOWN_MS - 1;
		await withVerificationResendCooldown(db, email, send, now);
		expect(send).toHaveBeenCalledTimes(1);
		time += 1;
		await withVerificationResendCooldown(db, email, send, now);
		expect(send).toHaveBeenCalledTimes(2);
	});

	it("allows only one in-flight operation across independently constructed callers", async () => {
		const started = deferred();
		const release = deferred();
		const send = vi.fn(async () => {
			started.resolve();
			await release.promise;
		});
		const first = withVerificationResendCooldown(db, email, send, now);
		await started.promise;
		try {
			await Promise.all(
				Array.from({ length: 20 }, () =>
					withVerificationResendCooldown(db, email.toUpperCase(), send, now),
				),
			);
			expect(send).toHaveBeenCalledTimes(1);
		} finally {
			release.resolve();
			await first;
		}
		expect((await cooldownRows()).results[0]?.count).toBe(0);
	});

	it("bounds persistent failures to five operations per address per minute, then recovers", async () => {
		const failure = new Error("provider remains unavailable");
		const send = vi.fn<() => Promise<void>>().mockRejectedValue(failure);
		for (let attempt = 0; attempt < VERIFICATION_RESEND_MAX_ATTEMPTS; attempt++)
			await expect(
				withVerificationResendCooldown(db, email, send, now),
			).rejects.toBe(failure);
		await withVerificationResendCooldown(db, email, send, now);
		expect(send).toHaveBeenCalledTimes(VERIFICATION_RESEND_MAX_ATTEMPTS);
		expect((await cooldownRows()).results).toEqual([]);
		time += VERIFICATION_RESEND_ATTEMPT_WINDOW_MS;
		send.mockResolvedValue();
		await withVerificationResendCooldown(db, email, send, now);
		expect(send).toHaveBeenCalledTimes(VERIFICATION_RESEND_MAX_ATTEMPTS + 1);
	});

	it("recovers an abandoned lease while fencing off the old owner's late failure", async () => {
		const started = deferred();
		const failOld = deferred();
		const first = withVerificationResendCooldown(
			db,
			email,
			async () => {
				started.resolve();
				await failOld.promise;
				throw new Error("abandoned request resumed");
			},
			now,
		);
		const failed = expect(first).rejects.toThrow("abandoned request resumed");
		await started.promise;
		time += VERIFICATION_RESEND_LEASE_MS;
		const replacement = vi.fn<() => Promise<void>>().mockResolvedValue();
		await withVerificationResendCooldown(db, email, replacement, now);
		const owner = (await cooldownRows()).results[0]?.id;
		failOld.resolve();
		await failed;
		expect((await cooldownRows()).results[0]).toMatchObject({ id: owner, count: 0 });
		await withVerificationResendCooldown(db, email, replacement, now);
		expect(replacement).toHaveBeenCalledTimes(1);
	});

	it("retains a successful delivery lease if cooldown finalization fails", async () => {
		const finalizationError = new Error("local D1 finalization fixture failed");
		const failingDb = {
			prepare(statement: string) {
				if (statement.startsWith("UPDATE rate_limit SET count=0"))
					return {
						bind: () => ({
							run: async () => {
								throw finalizationError;
							},
						}),
					};
				return db.prepare(statement);
			},
		} as D1Database;
		const send = vi.fn<() => Promise<void>>().mockResolvedValue();
		await expect(
			withVerificationResendCooldown(failingDb, email, send, now),
		).rejects.toBe(finalizationError);
		expect((await cooldownRows()).results[0]).toMatchObject({ count: 1 });
		await withVerificationResendCooldown(db, email, send, now);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("does not apply resend cooldown to signup/change-email request paths", async () => {
		const send = vi.fn<() => Promise<void>>().mockResolvedValue();
		for (const path of ["/sign-up/email", "/verify-email", "/change-email"])
			await sendVerificationMailWithCooldown(
				db,
				email,
				send,
				new Request(`${origin}/api/auth${path}`),
			);
		expect(send).toHaveBeenCalledTimes(3);
		expect((await cooldownRows()).results).toEqual([]);
	});

	it("real auth handler permits immediate retry after three delivery failures and suppresses a successful duplicate", async () => {
		await signUp();
		expect((await cooldownRows()).results).toEqual([]);
		captured.send
			.mockRejectedValueOnce(new Error("local mail failure 1"))
			.mockRejectedValueOnce(new Error("local mail failure 2"))
			.mockRejectedValueOnce(new Error("local mail failure 3"));
		expect((await resend()).status).toBe(500);
		expect(captured.send).toHaveBeenCalledTimes(3);
		expect((await cooldownRows()).results).toEqual([]);
		expect((await resend()).status).toBe(200);
		expect(captured.send).toHaveBeenCalledTimes(4);
		expect((await resend()).status).toBe(200);
		expect(captured.send).toHaveBeenCalledTimes(4);
	});

	it("request-less auth.api calls retain resend-only scope through Better Auth's endpoint context", async () => {
		await signUp();
		for (let attempt = 0; attempt < 2; attempt++) {
			const response = await auth.api.sendVerificationEmail({
				body: { email },
				asResponse: true,
			});
			expect(response.status).toBe(200);
		}
		expect(captured.send).toHaveBeenCalledTimes(1);
	});

	it("HTTP concurrent requests from different IPs send only one message and preserve generic account responses", async () => {
		await signUp();
		const started = deferred();
		const release = deferred();
		captured.send.mockImplementationOnce(async () => {
			started.resolve();
			await release.promise;
		});
		const first = resend();
		await started.promise;
		try {
			const duplicates = await Promise.all(
				Array.from({ length: 8 }, (_, index) =>
					resend(email, `192.0.2.${100 + index}`),
				),
			);
			for (const duplicate of duplicates) {
				expect(duplicate.status).toBe(200);
				expect(await duplicate.json()).toEqual({ status: true });
			}
			expect(captured.send).toHaveBeenCalledTimes(1);
			const unknown = await resend("missing@example.test", "192.0.2.200");
			expect(unknown.status).toBe(200);
			expect(await unknown.json()).toEqual({ status: true });
		} finally {
			release.resolve();
			expect((await first).status).toBe(200);
		}
	});

	it("keeps the separate per-IP HTTP abuse limit enabled even when sends are suppressed", async () => {
		await signUp();
		for (let attempt = 0; attempt < 10; attempt++)
			expect((await resend()).status).toBe(200);
		expect((await resend()).status).toBe(429);
		expect(captured.send).toHaveBeenCalledTimes(1);
	}, 15_000);
});
