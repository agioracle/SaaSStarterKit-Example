import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertIsolatedTestCheckout,
	testEnvironment,
	testState,
} from "./environment";
import { hashPassword } from "better-auth/crypto";
export default async function setup() {
	assertIsolatedTestCheckout();
	const state = testState();
	const run = (args: string[]) => {
		const result = spawnSync("npx", ["wrangler", ...args], {
			stdio: "pipe",
			encoding: "utf8",
			env: testEnvironment(),
		});
		if (result.status !== 0) throw Error(result.stdout + result.stderr);
	};
	run(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]);
	const password = await hashPassword("E2eFixturePassword!23");
	const now = Date.now();
	const roles = ["admin", "member", "other", "cursor"];
	const sql = roles
		.map(
			(role) =>
				`DELETE FROM user WHERE id='e2e-${role}'; INSERT INTO user(id,name,email,email_verified,created_at,updated_at,role,banned) VALUES('e2e-${role}','E2E ${role}','e2e.${role}@example.invalid',1,${now},${now},'${role === "admin" ? "admin" : "user"}',0); INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES('e2e-account-${role}','e2e-${role}','credential','e2e-${role}','${password}',${now},${now});`,
		)
		.join("\n");
	const directory = mkdtempSync(join(tmpdir(), "edgekit-fixtures-"));
	try {
		const file = join(directory, "seed.sql");
		writeFileSync(file, sql, { mode: 0o600 });
		run([
			"d1",
			"execute",
			"DB",
			"--local",
			"--persist-to",
			state,
			"--file",
			file,
		]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
