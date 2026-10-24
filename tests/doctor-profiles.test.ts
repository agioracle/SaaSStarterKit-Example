import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../scripts/cli/config";
import { runCli } from "../scripts/cli/runner";
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "doctor-profile-"));
	writeFileSync(
		join(dir, "wrangler.jsonc"),
		JSON.stringify({
			name: "fixture",
			main: "src/worker.ts",
			d1_databases: [
				{
					binding: "DB",
					database_name: "fixture-db",
					database_id: "00000000-0000-0000-0000-000000000000",
				},
			],
		}),
	);
	return dir;
}
describe("scenario-specific local doctor", () => {
	it("does not require gh/git or credentials for local preview", async () => {
		const cwd = fixture();
		const run = vi.fn(async () => ({ stdout: "fixture", stderr: "", code: 0 }));
		try {
			await runCli(parseArgs(["doctor"]), {
				cwd,
				run,
				env: { PATH: "/bin" },
				log: vi.fn(),
			});
			expect(
				run.mock.calls.map(
					(call) => (call as unknown as [{ executable: string }])[0].executable,
				),
			).toEqual(["npm", "npx"]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
	it("rejects missing auth configuration instead of pretending readiness", async () => {
		const cwd = fixture();
		try {
			writeFileSync(
				join(cwd, ".dev.vars"),
				"APP_ENV=test\nAPP_URL=http://localhost:3000",
			);
			await expect(
				runCli(parseArgs(["doctor", "--profile", "auth"]), {
					cwd,
					run: async () => ({ stdout: "", stderr: "", code: 0 }),
					env: {},
					log: vi.fn(),
				}),
			).rejects.toThrow("BETTER_AUTH_SECRET");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
	it("validates auth primitives locally without exposing values or contacting providers", async () => {
		const cwd = fixture();
		const log = vi.fn();
		try {
			writeFileSync(
				join(cwd, ".dev.vars"),
				"APP_ENV=test\nAPP_URL=http://localhost:3000\nBETTER_AUTH_SECRET=local-test-only-fixed-not-production-123456789\nGOOGLE_CLIENT_ID=fixture-id\nGOOGLE_CLIENT_SECRET=fixture-not-a-live-key",
			);
			await runCli(parseArgs(["doctor", "--profile", "auth"]), {
				cwd,
				run: async () => ({ stdout: "", stderr: "", code: 0 }),
				env: {},
				log,
			});
			expect(log.mock.calls.flat().join(" ")).not.toContain(
				"fixture-not-a-live-key",
			);
			expect(log.mock.calls.flat().join(" ")).toContain(
				"remain separate checks",
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
	it("rejects unknown profiles", () => {
		expect(() => parseArgs(["doctor", "--profile", "everything"])).toThrow(
			"profile",
		);
	});
});
