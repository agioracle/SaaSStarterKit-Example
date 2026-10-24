import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { studioPlan } from "./db-studio";
import { runProcess, type ProcessRunner } from "./cli/runner";
export function adminSql(email: string, revoke = false) {
	if (
		email.length > 254 ||
		!/^\S+@\S+\.\S+$/.test(email) ||
		Array.from(email).some((character) => character.charCodeAt(0) < 32)
	)
		throw new Error("A valid exact account email is required.");
	const safe = email.toLowerCase().replaceAll("'", "''");
	const role = revoke ? "user" : "admin";
	return `UPDATE user SET role='${role}' WHERE email='${safe}'; SELECT id,email,role FROM user WHERE email='${safe}';`;
}
export function verifyAdminResult(output: string, email: string, role: string) {
	let value: unknown;
	try {
		value = JSON.parse(output);
	} catch {
		throw new Error(
			"Role update response was unreadable; inspect the exact database before retrying.",
		);
	}
	const rows = (Array.isArray(value) ? value : [])
		.flatMap((item) =>
			item && typeof item === "object" && Array.isArray(item.results)
				? item.results
				: [],
		)
		.filter(
			(row) =>
				row &&
				typeof row === "object" &&
				row.email === email.toLowerCase() &&
				row.role === role,
		);
	if (rows.length !== 1)
		throw new Error(
			"The exact existing account role could not be verified. Check the email and database; no new account is created.",
		);
}
export async function runAdmin(
	options: {
		email: string;
		remote: boolean;
		execute: boolean;
		revoke: boolean;
		confirm?: string;
		confirmTarget?: string;
		file?: string;
	},
	dependencies: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		run?: ProcessRunner;
		log?: (message: string) => void;
	} = {},
) {
	const cwd = dependencies.cwd || process.cwd();
	const log = dependencies.log || console.log;
	const sql = adminSql(options.email, options.revoke);
	const plan = studioPlan(cwd, options, dependencies.env || process.env);
	log(
		`${options.remote ? "Remote" : "Local"} account role change: ${options.email} -> ${options.revoke ? "user" : "admin"}. Exact database target: ${plan.target}`,
	);
	if (!options.execute) {
		log(
			"Dry run only. Role changes grant or remove administrative access. Re-run only after checking the exact account and database.",
		);
		return;
	}
	if (
		options.confirm !== options.email ||
		options.confirmTarget !== plan.target
	)
		throw new Error(
			"Execution requires --confirm EXACT_EMAIL and --confirm-target EXACT_DISPLAYED_DATABASE_TARGET.",
		);
	const command = options.remote
		? {
				executable: "npx",
				args: [
					"--no-install",
					"wrangler",
					"d1",
					"execute",
					"DB",
					"--remote",
					"--config",
					resolve(cwd, "wrangler.jsonc"),
					"--command",
					sql,
					"--json",
				],
				env: plan.command.env,
			}
		: {
				executable: process.execPath,
				args: ["--import", "tsx", resolve(cwd, "scripts/admin-local.ts")],
				env: {
					...plan.command.env,
					ADMIN_EMAIL: options.email.toLowerCase(),
					ADMIN_ROLE: options.revoke ? "user" : "admin",
				},
			};
	const result = await (dependencies.run || runProcess)(command, cwd);
	if (result.code !== 0)
		throw new Error(
			"Role change failed or has an uncertain outcome. Inspect the database before retrying; raw output is suppressed.",
		);
	verifyAdminResult(
		result.stdout,
		options.email,
		options.revoke ? "user" : "admin",
	);
	log("Verified the exact existing account role. No account was created.");
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			local: { type: "boolean" },
			remote: { type: "boolean" },
			execute: { type: "boolean" },
			revoke: { type: "boolean" },
			confirm: { type: "string" },
			"confirm-target": { type: "string" },
			file: { type: "string" },
			help: { type: "boolean" },
		},
	});
	if (values.help)
		console.log(
			"Usage: npm run db:admin:local -- EXACT_EMAIL [--revoke] [--execute --confirm EXACT_EMAIL --confirm-target EXACT_DATABASE_PATH]\nRemote mode requires exact configured account/database credentials and database UUID confirmation. Dry-run default.",
		);
	else if (values.local && values.remote) {
		console.error("Choose one database target.");
		process.exitCode = 1;
	} else
		runAdmin({
			email: positionals[0] || "",
			remote: values.remote || false,
			execute: values.execute || false,
			revoke: values.revoke || false,
			confirm: values.confirm,
			confirmTarget: values["confirm-target"],
			file: values.file,
		}).catch((error) => {
			console.error(
				error instanceof Error ? error.message : "Admin command failed.",
			);
			process.exitCode = 1;
		});
}
