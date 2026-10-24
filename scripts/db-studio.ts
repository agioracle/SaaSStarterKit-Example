import { spawn } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isObject, readJson, validId } from "./cli/config.ts";
import { childEnvironment, redact } from "./cli/secrets.ts";
import type { ProcessCommand, ProcessRunner } from "./cli/runner.ts";

export interface StudioOptions {
	remote: boolean;
	execute: boolean;
	confirm?: string;
	file?: string;
}
export function findLocalDatabase(cwd: string, explicitFile?: string): string {
	const root = resolve(cwd, ".wrangler/state/v3/d1");
	if (!existsSync(root))
		throw new Error(
			"No local D1 state exists. Run the local migration command first.",
		);
	const candidates: string[] = [];
	function walk(path: string): void {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const full = join(path, entry.name);
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) walk(full);
			else if (
				entry.isFile() &&
				entry.name.endsWith(".sqlite") &&
				entry.name !== "metadata.sqlite"
			)
				candidates.push(full);
		}
	}
	walk(root);
	if (explicitFile) {
		const file = resolve(cwd, explicitFile);
		if (
			!existsSync(file) ||
			lstatSync(file).isSymbolicLink() ||
			relative(realpathSync(root), realpathSync(file)).startsWith("..") ||
			!candidates.includes(file)
		)
			throw new Error(
				"--file must select an existing non-symlink D1 SQLite file under this project’s .wrangler/state/v3/d1.",
			);
		return file;
	}
	const wrangler = readJson(resolve(cwd, "wrangler.jsonc"));
	if (
		!isObject(wrangler) ||
		!Array.isArray(wrangler.d1_databases) ||
		wrangler.d1_databases.length !== 1 ||
		!isObject(wrangler.d1_databases[0]) ||
		wrangler.d1_databases[0].binding !== "DB"
	)
		throw new Error(
			"Automatic local selection requires exactly one configured D1 binding named DB; select an exact --file after checking it.",
		);
	if (candidates.length !== 1)
		throw new Error(
			`Found ${candidates.length} local D1 database files. Specify --file with the exact DB file after checking the binding; metadata.sqlite is never selected.`,
		);
	return candidates[0];
}
export function studioPlan(
	cwd: string,
	options: StudioOptions,
	env: NodeJS.ProcessEnv,
): { command: ProcessCommand; configSource: string; target: string } {
	const configPath = resolve(
		cwd,
		`.saas/drizzle-studio-${options.remote ? "remote" : "local"}.config.ts`,
	);
	if (!options.remote) {
		const database = findLocalDatabase(cwd, options.file);
		return {
			target: database,
			configSource: `export default { dialect: 'sqlite', schema: './src/db/schema.ts', dbCredentials: { url: process.env.DB_LOCAL_URL } };\n`,
			command: {
				executable: "npx",
				args: [
					"--no-install",
					"drizzle-kit",
					"studio",
					"--host",
					"127.0.0.1",
					"--config",
					configPath,
				],
				env: childEnvironment(env, {
					DB_LOCAL_URL: pathToFileURL(database).href,
				}),
			},
		};
	}
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const databaseId = env.CLOUDFLARE_DATABASE_ID;
	const token = env.CLOUDFLARE_API_TOKEN;
	if (
		!accountId ||
		!/^[a-f0-9]{32}$/i.test(accountId) ||
		!databaseId ||
		!validId("d1", databaseId) ||
		!token
	)
		throw new Error(
			"Remote Studio requires explicit CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, and CLOUDFLARE_API_TOKEN in the shell. Values are never logged.",
		);
	const wrangler = readJson(resolve(cwd, "wrangler.jsonc"));
	const bindings =
		isObject(wrangler) && Array.isArray(wrangler.d1_databases)
			? wrangler.d1_databases.filter(
					(value) => isObject(value) && value.binding === "DB",
				)
			: [];
	if (
		bindings.length !== 1 ||
		!isObject(bindings[0]) ||
		bindings[0].database_id !== databaseId ||
		(isObject(wrangler) &&
			wrangler.account_id &&
			wrangler.account_id !== accountId)
	)
		throw new Error(
			"Remote Studio account/database must match the exact DB binding in Wrangler.",
		);
	return {
		target: databaseId,
		configSource: `export default { dialect: 'sqlite', driver: 'd1-http', schema: './src/db/schema.ts', dbCredentials: { accountId: process.env.CLOUDFLARE_ACCOUNT_ID, databaseId: process.env.CLOUDFLARE_DATABASE_ID, token: process.env.CLOUDFLARE_API_TOKEN } };\n`,
		command: {
			executable: "npx",
			args: [
				"--no-install",
				"drizzle-kit",
				"studio",
				"--host",
				"127.0.0.1",
				"--config",
				configPath,
			],
			env: childEnvironment(env, {
				CLOUDFLARE_ACCOUNT_ID: accountId,
				CLOUDFLARE_DATABASE_ID: databaseId,
				CLOUDFLARE_API_TOKEN: token,
			}),
		},
	};
}
const launchStudio: ProcessRunner = (command, cwd) =>
	new Promise((resolveResult, reject) => {
		const child = spawn(command.executable, command.args, {
			cwd,
			env: command.env,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const secrets = { token: command.env?.CLOUDFLARE_API_TOKEN || "" };
		let output = "";
		let errors = "";
		const flush = (stream: "out" | "err", final = false) => {
			let buffer = stream === "out" ? output : errors;
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline + 1);
				(stream === "out" ? process.stdout : process.stderr).write(
					redact(line, secrets),
				);
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
			}
			if (final && buffer) {
				(stream === "out" ? process.stdout : process.stderr).write(
					redact(buffer, secrets),
				);
				buffer = "";
			}
			if (buffer.length > 65536)
				buffer = "[oversized diagnostic output suppressed]";
			if (stream === "out") output = buffer;
			else errors = buffer;
		};
		child.stdout.on("data", (data) => {
			output += String(data);
			flush("out");
		});
		child.stderr.on("data", (data) => {
			errors += String(data);
			flush("err");
		});
		child.on("error", () =>
			reject(
				new Error(
					"Could not launch Drizzle Studio. Check your installed dependencies.",
				),
			),
		);
		child.on("close", (code) => {
			flush("out", true);
			flush("err", true);
			resolveResult({ code: code ?? 1, stdout: "", stderr: "" });
		});
	});
export async function runStudio(
	options: StudioOptions,
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
	const plan = studioPlan(cwd, options, env);
	log(
		`${options.remote ? "Remote D1" : "Local D1"} Studio target: ${plan.target}. Browser UI can read and write this database. Listener is restricted to 127.0.0.1.`,
	);
	if (!options.execute) {
		log("Dry run. No server, provider request, or file write occurred.");
		return;
	}
	const required = options.remote ? plan.target : "local";
	if (options.confirm !== required)
		throw new Error(
			`Studio execution requires --confirm ${required}. Remote D1 may contain production data.`,
		);
	if (
		!options.remote &&
		!existsSync(resolve(cwd, "node_modules/@libsql/client")) &&
		!existsSync(resolve(cwd, "node_modules/better-sqlite3"))
	)
		throw new Error(
			"Local Studio requires @libsql/client or better-sqlite3. Install the pinned project dependencies first.",
		);
	const configPath = plan.command.args[plan.command.args.length - 1];
	mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
	writeFileSync(configPath, plan.configSource, { flag: "wx", mode: 0o600 });
	try {
		const result = await (dependencies.run || launchStudio)(plan.command, cwd);
		if (result.code)
			throw new Error(`Drizzle Studio exited with code ${result.code}.`);
	} finally {
		unlinkSync(configPath);
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
			help: { type: "boolean" },
		},
		strict: true,
	});
	if (values.help)
		console.log(
			"Usage: npm run db:studio:local -- [--file exact.sqlite] [--execute --confirm local]\n       npm run db:studio:remote -- [--execute --confirm EXACT_DATABASE_UUID]\nDry-run is default; remote requires explicit shell account/database/token.",
		);
	else if (values.local && values.remote) {
		console.error("Choose --local or --remote, not both.");
		process.exitCode = 1;
	} else
		runStudio({
			remote: values.remote || false,
			execute: values.execute || false,
			confirm: values.confirm,
			file: values.file,
		}).catch((error) => {
			console.error(error instanceof Error ? error.message : "Studio failed");
			process.exitCode = 1;
		});
}
