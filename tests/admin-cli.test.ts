import { describe, it, expect } from "vitest";
import { adminSql } from "../scripts/admin";
describe("explicit admin role SQL", () => {
	it("escapes apostrophes and normalizes email without SQL interpolation injection", () => {
		expect(adminSql("o'hara@example.invalid")).toContain(
			"email='o''hara@example.invalid'",
		);
		expect(adminSql("USER@example.invalid", true)).toContain("role='user'");
	});
	it("rejects empty and multiline identities", () => {
		for (const email of ["", "user@example.invalid\nDROP TABLE user", "bad"])
			expect(() => adminSql(email)).toThrow("email");
	});
});
import { verifyAdminResult, runAdmin } from "../scripts/admin";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
it("never reports success for a nonexistent account", () => {
	expect(() =>
		verifyAdminResult('[{"results":[]}]', "user@example.invalid", "admin"),
	).toThrow("could not be verified");
	expect(() =>
		verifyAdminResult(
			'[{"results":[{"email":"user@example.invalid","role":"admin"}]}]',
			"user@example.invalid",
			"admin",
		),
	).not.toThrow();
});
it("runs local admin against the exact selected SQLite file, not Wrangler default", async () => {
	const root = mkdtempSync("/tmp/edgekit-admin-test-");
	try {
		const directory = join(root, ".wrangler/state/v3/d1/db");
		mkdirSync(directory, { recursive: true });
		const first = join(directory, "first.sqlite"),
			second = join(directory, "second.sqlite");
		writeFileSync(first, "fixture");
		writeFileSync(second, "fixture");
		const runner = vi
			.fn()
			.mockResolvedValue({
				code: 0,
				stdout:
					'[{"results":[{"email":"user@example.invalid","role":"admin"}]}]',
				stderr: "",
			});
		await runAdmin(
			{
				email: "user@example.invalid",
				remote: false,
				execute: true,
				revoke: false,
				file: second,
				confirm: "user@example.invalid",
				confirmTarget: second,
			},
			{ cwd: root, env: {}, run: runner, log: vi.fn() },
		);
		expect(runner.mock.calls[0][0].env.DB_LOCAL_URL).toBe(`file://${second}`);
		expect(runner.mock.calls[0][0].args).toContain(
			join(root, "scripts/admin-local.ts"),
		);
		expect(runner.mock.calls[0][0].args).not.toContain("wrangler");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
