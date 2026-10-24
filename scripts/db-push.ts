import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { studioPlan } from "./db-studio.ts";
import {
	commandText,
	runProcess,
	type ProcessCommand,
	type ProcessRunner,
} from "./cli/runner.ts";

export interface PushOptions {
	remote: boolean;
	execute: boolean;
	confirm?: string;
	file?: string;
	ackDataLoss: boolean;
}
export function databasePushPlan(
	cwd: string,
	options: PushOptions,
	env: NodeJS.ProcessEnv,
): {
	command: ProcessCommand;
	configSource: string;
	target: string;
	configPath: string;
} {
	// Reuse Studio's exact, non-symlink DB discovery and remote account/binding checks.
	const database = studioPlan(cwd, options, env);
	const configPath = resolve(
		cwd,
		`.saas/drizzle-push-${options.remote ? "remote" : "local"}.config.ts`,
	);
	return {
		target: database.target,
		configSource: database.configSource,
		configPath,
		command: {
			executable: "npx",
			args: [
				"--no-install",
				"drizzle-kit",
				"push",
				"--config",
				configPath,
				"--force",
			],
			env: database.command.env,
		},
	};
}
export async function runDatabasePush(
	options: PushOptions,
	dependencies: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		run?: ProcessRunner;
		log?: (message: string) => void;
	} = {},
): Promise<void> {
	const cwd = dependencies.cwd || process.cwd();
	const env = dependencies.env || process.env;
	const log = dependencies.log || console.log;
	const plan = databasePushPlan(cwd, options, env);
	log(
		`${options.remote ? "Remote D1" : "Local D1"} schema-push target: ${plan.target}`,
	);
	log(
		"WARNING: push directly reconciles src/db/schema.ts with the database, may permanently drop data, and does not create/apply versioned migration files. Prefer reviewed migrations for production. Back up first.",
	);
	log(commandText(plan.command));
	if (!options.execute) {
		log(
			"Dry run only: this is a target/command plan, not a live schema diff. No database was inspected or changed; no process ran or file was written.",
		);
		return;
	}
	if (options.confirm !== plan.target)
		throw new Error(
			`Schema push requires --confirm "${plan.target}" matching the exact displayed database target.`,
		);
	if (!options.ackDataLoss)
		throw new Error(
			"Schema push requires --ack-data-loss. Drizzle --force accepts potentially destructive schema reconciliation; this is not a migration command.",
		);
	if (
		!options.remote &&
		!existsSync(resolve(cwd, "node_modules/@libsql/client")) &&
		!existsSync(resolve(cwd, "node_modules/better-sqlite3"))
	)
		throw new Error(
			"Local schema push requires the pinned @libsql/client or better-sqlite3 dependency.",
		);
	const pendingPath = resolve(cwd, ".saas/db-push-pending.json");
	if (existsSync(pendingPath))
		throw new Error(
			"A prior schema push has an unresolved outcome. Inspect that exact database/schema and reconcile .saas/db-push-pending.json before retrying; never blindly repeat push.",
		);
	mkdirSync(dirname(plan.configPath), { recursive: true, mode: 0o700 });
	writeFileSync(plan.configPath, plan.configSource, {
		flag: "wx",
		mode: 0o600,
	});
	try {
		writeFileSync(
			pendingPath,
			`${JSON.stringify({ schemaVersion: 1, mode: options.remote ? "remote" : "local", target: plan.target }, null, 2)}\n`,
			{ flag: "wx", mode: 0o600 },
		);
		const result = await (dependencies.run || runProcess)(plan.command, cwd);
		if (result.code !== 0)
			throw new Error(
				`Schema push exited with code ${result.code}. It may have partially changed the database; inspect it before retrying. Raw output is suppressed to protect credentials.`,
			);
		unlinkSync(pendingPath);
		log(
			"Schema push command completed. Review the resulting schema/data before continuing; versioned migration history was not updated.",
		);
	} finally {
		unlinkSync(plan.configPath);
	}
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const { values } = parseArgs({
		options: {
			local: { type: "boolean" },
			remote: { type: "boolean" },
			execute: { type: "boolean" },
			confirm: { type: "string" },
			file: { type: "string" },
			"ack-data-loss": { type: "boolean" },
			help: { type: "boolean" },
		},
		strict: true,
	});
	if (values.help)
		console.log(
			"Usage: npm run db:push:local -- [--file exact.sqlite] [--execute --confirm EXACT_SQLITE_PATH --ack-data-loss]\n       npm run db:push:remote -- [--execute --confirm EXACT_D1_UUID --ack-data-loss]\nDry-run default. push can permanently destroy data and does not maintain migrations.",
		);
	else if (values.local && values.remote) {
		console.error("Choose --local or --remote, not both.");
		process.exitCode = 1;
	} else
		runDatabasePush({
			remote: values.remote || false,
			execute: values.execute || false,
			confirm: values.confirm,
			file: values.file,
			ackDataLoss: values["ack-data-loss"] || false,
		}).catch((error) => {
			console.error(
				error instanceof Error ? error.message : "Schema push failed",
			);
			process.exitCode = 1;
		});
}
