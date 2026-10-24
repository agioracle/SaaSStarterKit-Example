import { authEnvironment, type Bindings } from "../../src/env/index";
import { spawn } from "node:child_process";
import {
	existsSync,
	readFileSync,
	copyFileSync,
	writeFileSync,
	mkdirSync,
	openSync,
	closeSync,
	unlinkSync,
	lstatSync,
	cpSync,
} from "node:fs";
import { resolve, relative } from "node:path";
import {
	defaultConfig,
	isObject,
	loadConfig,
	loadState,
	parseJsonc,
	STAGES,
	type Options,
	type ResourceKind,
	type SetupConfig,
	type SetupState,
	type Stage,
	writeJson,
} from "./config.ts";
import {
	assertAccount,
	createCloudflareApi,
	findByName,
	getResource,
	ProviderError,
	resourceFromResult,
	resourcePath,
	type CloudflareApi,
} from "./provider.ts";
import {
	childEnvironment,
	PUBLIC_VARIABLES,
	readEnv,
	splitEnvironment,
	type EnvironmentValues,
} from "./secrets.ts";

export interface ProcessCommand {
	executable: string;
	args: string[];
	input?: string;
	env?: NodeJS.ProcessEnv;
	verifyPublic?: { key: string; value: string | null; args: string[] };
}
export interface RunResult {
	stdout: string;
	stderr: string;
	code: number;
}
export type ProcessRunner = (
	command: ProcessCommand,
	cwd: string,
) => Promise<RunResult>;
export const runProcess: ProcessRunner = (command, cwd) =>
	new Promise((resolveResult, reject) => {
		const child = spawn(command.executable, command.args, {
			cwd,
			shell: false,
			env: command.env || childEnvironment(process.env),
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const limit = 4 * 1024 * 1024;
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(
				new Error(
					"Command exceeded 10 minutes. Outcome may be uncertain; inspect before retrying.",
				),
			);
		}, 600_000);
		child.stdout.on("data", (chunk) => {
			stdout = (stdout + String(chunk)).slice(-limit);
		});
		child.stderr.on("data", (chunk) => {
			stderr = (stderr + String(chunk)).slice(-limit);
		});
		child.on("error", () => {
			clearTimeout(timer);
			reject(
				new Error(
					`Could not start ${command.executable}. Check that the tool is installed. No output or secret values are logged.`,
				),
			);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolveResult({ stdout, stderr, code: code ?? 1 });
		});
		child.stdin.on("error", () => {
			/* An early-exiting child may close stdin before consuming it. */
		});
		child.stdin.end(command.input);
	});
export interface Dependencies {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	run?: ProcessRunner;
	api?: CloudflareApi;
	log?: (message: string) => void;
}
const resources: ResourceKind[] = ["d1", "r2", "kv"];
export function stagesFor(options: Options): Stage[] {
	if (options.steps) {
		if (!["plan", "apply", "resume"].includes(options.command))
			throw new Error("--steps is accepted only for plan, apply, or resume.");
		return STAGES.filter((stage) => options.steps?.includes(stage));
	}
	switch (options.command) {
		case "plan":
		case "apply":
		case "resume":
			return ["provision", "configure"];
		case "adopt":
			return ["provision", "configure"];
		case "configure":
			return ["configure"];
		case "migrate":
			return [options.remote ? "migrate-remote" : "migrate-local"];
		case "build":
			return ["build"];
		case "deploy":
			return ["build", "deploy"];
		case "sync-worker-secrets":
			return ["worker-secrets"];
		case "sync-github-secrets":
			return ["github-secrets"];
		case "repo":
			return ["repo"];
		case "push":
			return ["push"];
		default:
			return [];
	}
}
export function assertAuthorized(
	options: Options,
	project: string,
	stages: string[],
): void {
	if (!options.execute) return;
	if (options.confirm !== project)
		throw new Error(
			`Execution requires --confirm ${project}. Review the printed plan first.`,
		);
	const missing = stages.filter((stage) => !options.allow.includes(stage));
	if (missing.length)
		throw new Error(
			`Execution requires --allow ${missing.join(",")} for the selected stages. No automatic broad approval is accepted.`,
		);
}
export function commandText(command: ProcessCommand): string {
	return (
		[command.executable, ...command.args]
			.map((value) =>
				/^[\w./:@=-]+$/.test(value) ? value : JSON.stringify(value),
			)
			.join(" ") + (command.input === undefined ? "" : " < [redacted stdin]")
	);
}
export function stageCommands(
	stage: Stage,
	config: SetupConfig,
): ProcessCommand[] {
	switch (stage) {
		case "install":
			return [{ executable: "npm", args: ["ci"] }];
		case "migrate-local":
			return [
				{
					executable: "npx",
					args: [
						"--no-install",
						"wrangler",
						"d1",
						"migrations",
						"apply",
						"DB",
						"--local",
						"--config",
						"wrangler.jsonc",
					],
				},
			];
		case "migrate-remote":
			return [
				{
					executable: "npx",
					args: [
						"--no-install",
						"wrangler",
						"d1",
						"migrations",
						"apply",
						"DB",
						"--remote",
						"--config",
						"wrangler.jsonc",
					],
				},
			];
		case "build":
			return [{ executable: "npm", args: ["run", "build"] }];
		case "deploy":
			return [
				{ executable: "npx", args: ["--no-install", "wrangler", "deploy"] },
			];
		case "repo":
			if (!config.repository)
				throw new Error("A repository owner/name is required.");
			return [
				{
					executable: "gh",
					args: ["repo", "create", config.repository, "--private"],
				},
			];
		case "push":
			if (!config.repository)
				throw new Error("A repository owner/name is required.");
			return [
				{
					executable: "git",
					args: [
						"push",
						`https://github.com/${config.repository}.git`,
						"HEAD:refs/heads/main",
					],
				},
			];
		default:
			return [];
	}
}
export function secretCommands(
	stage: "worker-secrets" | "github-secrets",
	config: SetupConfig,
	options: Options,
	source: EnvironmentValues,
): ProcessCommand[] {
	if (stage !== "github-secrets" && options.clearPublic?.length)
		throw new Error("--clear-public only applies to GitHub public variables.");
	const values = splitEnvironment(source);
	if (
		values.deployment.CLOUDFLARE_ACCOUNT_ID &&
		config.accountId &&
		values.deployment.CLOUDFLARE_ACCOUNT_ID !== config.accountId
	)
		throw new Error(
			"Environment file Cloudflare account differs from the approved target.",
		);
	if (stage === "worker-secrets") {
		if (!Object.keys(values.runtime).length)
			throw new Error(
				"No non-empty runtime values selected. Runtime uploads never include VITE_* or deployment tokens (the non-secret account ID is explicitly dual-use).",
			);
		return [
			{
				executable: "npx",
				args: [
					"--no-install",
					"wrangler",
					"secret",
					"bulk",
					"--name",
					config.project,
					"--config",
					"wrangler.jsonc",
				],
				input: JSON.stringify(values.runtime),
			},
		];
	}
	if (!config.repository)
		throw new Error(
			"--repo owner/name is required for GitHub synchronization.",
		);
	if (!options.publicVars && !options.credentials && !options.runtimeSecrets)
		throw new Error(
			"Select GitHub destinations with --public-vars and/or --credentials. --runtime-secrets is an explicit, optional separate destination.",
		);
	const suffix = [
		"--repo",
		config.repository,
		...(config.githubEnvironment ? ["--env", config.githubEnvironment] : []),
	];
	const commands: ProcessCommand[] = [];
	const clear = new Set(options.clearPublic ?? []);
	if (clear.size && !options.publicVars)
		throw new Error("--clear-public requires --public-vars.");
	for (const key of clear)
		if (!PUBLIC_VARIABLES.has(key))
			throw new Error(
				`Only allowlisted public variables may be cleared: ${key}`,
			);
	if (options.publicVars) {
		for (const [key, value] of Object.entries(values.public)) {
			if (clear.has(key)) {
				if (value.trim())
					throw new Error(
						`Cannot clear non-empty public variable ${key}; remove its local value first.`,
					);
				continue;
			}
			if (!value.trim())
				throw new Error(
					`Public variable ${key} is explicitly empty. Use --clear-public ${key} to remove it remotely, or omit the local key to leave it unchanged.`,
				);
			commands.push({
				executable: "gh",
				args: ["variable", "set", key, ...suffix],
				input: value,
				verifyPublic: {
					key,
					value,
					args: ["variable", "list", "--json", "name,value", ...suffix],
				},
			});
		}
		for (const key of clear)
			commands.push({
				executable: "gh",
				args: ["variable", "delete", key, ...suffix],
				verifyPublic: {
					key,
					value: null,
					args: ["variable", "list", "--json", "name,value", ...suffix],
				},
			});
	}
	if (options.credentials)
		for (const [key, value] of Object.entries(values.deployment))
			commands.push({
				executable: "gh",
				args: [
					key === "CLOUDFLARE_API_TOKEN" ? "secret" : "variable",
					"set",
					key,
					...suffix,
				],
				input: value,
			});
	if (options.runtimeSecrets)
		for (const [key, value] of Object.entries(values.runtime))
			commands.push({
				executable: "gh",
				args: ["secret", "set", key, ...suffix],
				input: value,
			});
	if (!commands.length)
		throw new Error(
			"No non-empty values match the selected GitHub categories.",
		);
	return commands;
}
export function renderPlan(
	config: SetupConfig,
	state: SetupState,
	stages: Stage[],
): string[] {
	const lines = [
		`Project: ${config.project}`,
		`Cloudflare account: ${config.accountId || "(not configured)"}`,
		`Origin: ${config.origin || "(not configured)"}`,
		`Domain route: ${config.domain || "(workers.dev only)"}`,
		`GitHub repository: ${config.repository || "(none)"}`,
		"D1, R2, Workers, and KV may incur charges. Remote stages are opt-in.",
	];
	for (const stage of stages) {
		if (stage === "provision")
			for (const kind of resources)
				lines.push(
					`[${stage}] ${kind}: ${state.resources[kind] ? `verify recorded ${state.resources[kind]?.id}` : config.resources[kind].id ? `verify/adopt ${config.resources[kind].id}` : `check exact name ${config.resources[kind].name}, then create only if absent`}`,
				);
		else if (stage === "configure")
			lines.push(
				"[configure] Back up and update local Wrangler bindings, production public env, and setup manifest. Never write credentials.",
			);
		else if (stage === "worker-secrets")
			lines.push(
				"[worker-secrets] Upload only allowlisted runtime names via stdin to the exact Worker.",
			);
		else if (stage === "github-secrets")
			lines.push(
				"[github-secrets] Sync explicitly selected public variables/deployment credentials/runtime secrets to the exact GitHub repository/environment.",
			);
		else
			for (const command of stageCommands(stage, config))
				lines.push(`[${stage}] ${commandText(command)}`);
	}
	return lines;
}
function readWrangler(cwd: string): Record<string, unknown> {
	const path = resolve(cwd, "wrangler.jsonc");
	if (!existsSync(path))
		throw new Error(
			"Missing wrangler.jsonc. Run this CLI from the starter root or use --directory.",
		);
	const value = parseJsonc(readFileSync(path, "utf8"));
	if (!isObject(value))
		throw new Error("Wrangler configuration must be an object.");
	if (isObject(value.env) && Object.keys(value.env).length)
		throw new Error(
			"Named Wrangler environments are not supported by this CLI. Use a separate project directory/configuration; refusing an ambiguous target.",
		);
	return value;
}
function assertBindings(
	cwd: string,
	config: SetupConfig,
	state: SetupState,
): void {
	const wrangler = readWrangler(cwd);
	if (
		isObject(wrangler.vars) &&
		Object.keys(wrangler.vars).some((key) =>
			/SECRET|TOKEN|PRIVATE_KEY|API_KEY/.test(key),
		)
	)
		throw new Error(
			"Wrangler vars contains credential-like names. Move runtime secrets to a private env file and deployment credentials to the shell.",
		);
	if (wrangler.name !== config.project)
		throw new Error(
			"Wrangler Worker name differs from the approved project. Run configure first.",
		);
	const descriptions: [ResourceKind, string, string, string][] = [
		["d1", "d1_databases", "DB", "database_id"],
		["r2", "r2_buckets", "BUCKET", "bucket_name"],
		["kv", "kv_namespaces", "CACHE", "id"],
	];
	for (const [kind, key, binding, idKey] of descriptions) {
		const array = wrangler[key];
		const record = Array.isArray(array)
			? array.find((item) => isObject(item) && item.binding === binding)
			: undefined;
		if (
			!state.resources[kind] ||
			!isObject(record) ||
			record[idKey] !== state.resources[kind]?.id ||
			record.remote === true
		)
			throw new Error(
				`${kind} binding is missing, remote-enabled locally, or differs from recorded state. Adopt/configure verified resources first.`,
			);
	}
	if (wrangler.account_id && wrangler.account_id !== config.accountId)
		throw new Error("Wrangler account_id differs from the approved account.");
}
export function configureProject(
	cwd: string,
	config: SetupConfig,
	state: SetupState,
	configPath: string,
): void {
	if (!config.origin)
		throw new Error(
			"Configure requires --origin https://your-production-host (or --domain).",
		);
	for (const kind of resources)
		if (!state.resources[kind])
			throw new Error(
				`Cannot configure an unverified ${kind} resource. Use provision or adopt first.`,
			);
	const wrangler = readWrangler(cwd);
	const replaceBinding = (
		key: string,
		binding: string,
		value: Record<string, unknown>,
	) => {
		const old = Array.isArray(wrangler[key])
			? (wrangler[key] as unknown[])
			: [];
		wrangler[key] = [
			...old.filter((item) => !isObject(item) || item.binding !== binding),
			value,
		];
	};
	wrangler.name = config.project;
	wrangler.account_id = config.accountId;
	replaceBinding("d1_databases", "DB", {
		binding: "DB",
		database_name: state.resources.d1?.name,
		database_id: state.resources.d1?.id,
		migrations_dir: "drizzle",
	});
	replaceBinding("r2_buckets", "BUCKET", {
		binding: "BUCKET",
		bucket_name: state.resources.r2?.id,
	});
	replaceBinding("kv_namespaces", "CACHE", {
		binding: "CACHE",
		id: state.resources.kv?.id,
	});
	wrangler.vars = {
		...(isObject(wrangler.vars) ? wrangler.vars : {}),
		APP_ENV: "production",
		APP_URL: config.origin,
	};
	if (config.domain)
		wrangler.routes = [{ pattern: config.domain, custom_domain: true }];
	else delete wrangler.routes;
	const wranglerPath = resolve(cwd, "wrangler.jsonc");
	if (!existsSync(`${wranglerPath}.backup`))
		copyFileSync(wranglerPath, `${wranglerPath}.backup`);
	const publicPath = resolve(cwd, ".env.production");
	const publicEnv = existsSync(publicPath) ? readEnv(publicPath) : {};
	const categories = splitEnvironment(publicEnv);
	if (
		Object.keys(categories.runtime).length ||
		Object.keys(categories.deployment).length
	)
		throw new Error(
			".env.production must contain public build variables only. Move runtime values and deployment credentials out before configuring.",
		);
	const updatedPublic = {
		...categories.public,
		VITE_BASE_URL: config.origin,
		VITE_APP_URL: config.origin,
		...(config.payment === "none" ? { VITE_PAYMENT_PROVIDER: "none" } : {}),
	};
	writeJson(wranglerPath, wrangler);
	if (existsSync(publicPath) && !existsSync(`${publicPath}.backup`))
		copyFileSync(publicPath, `${publicPath}.backup`);
	writeFileSync(
		publicPath,
		`${Object.entries(updatedPublic)
			.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
			.join("\n")}\n`,
		{ mode: 0o600 },
	);
	writeJson(configPath, config);
}
function cleanTemplatePath(path: string): boolean {
	return !path
		.split(/[\\/]/)
		.some(
			(part) =>
				[
					".git",
					"node_modules",
					".saas",
					".local-smoke",
					".content-collections",
					".wrangler",
					"dist",
					".output",
					".tanstack",
					"coverage",
					"test-results",
					"playwright-report",
				].includes(part) ||
				((part.startsWith(".env") || part.startsWith(".dev.vars")) &&
					!part.endsWith(".example")) ||
				part.endsWith(".backup") ||
				part.endsWith(".pem") ||
				part.endsWith(".key"),
		);
}
export function copyTemplate(source: string, destination: string): void {
	if (source === destination || !relative(source, destination).startsWith(".."))
		throw new Error(
			"Create destination must be outside the source template directory.",
		);
	if (existsSync(destination))
		throw new Error(
			"Create destination already exists. Nothing was overwritten.",
		);
	cpSync(source, destination, {
		recursive: true,
		filter: (path) =>
			cleanTemplatePath(relative(source, path)) &&
			!lstatSync(path).isSymbolicLink(),
	});
}
async function doctor(
	cwd: string,
	options: Options,
	dependencies: Dependencies,
): Promise<void> {
	const log = dependencies.log || console.log;
	const run = dependencies.run || runProcess;
	const env = dependencies.env || process.env;
	const version = process.versions.node.split(".").map(Number);
	if (version[0] < 22 || (version[0] === 22 && version[1] < 12))
		throw new Error("Node >=22.12 is required.");
	log(`Node ${process.versions.node}: OK`);
	const profile = options.profile || "local-preview";
	log(
		`Doctor profile: ${profile}. Configuration checks only; no provider delivery or application readiness guarantee.`,
	);
	let failures = 0;
	for (const command of [
		{ executable: "npm", args: ["--version"] },
		...(profile === "deploy" || options.checkAuth
			? [
					{ executable: "git", args: ["--version"] },
					{ executable: "gh", args: ["--version"] },
				]
			: []),
		{ executable: "npx", args: ["--no-install", "wrangler", "--version"] },
	]) {
		try {
			const result = await run({ ...command, env: childEnvironment(env) }, cwd);
			if (result.code) throw new Error("unavailable");
			log(`${command.executable}: OK`);
		} catch {
			failures++;
			log(
				`${command.executable}: missing or unusable. Install it manually from its official source.`,
			);
		}
	}
	try {
		readWrangler(cwd);
		log("Wrangler configuration: readable");
	} catch (error) {
		failures++;
		log(
			error instanceof Error ? error.message : "Invalid Wrangler configuration",
		);
	}
	for (const file of [".env", ".dev.vars", ".env.production"])
		log(
			`${file}: ${existsSync(resolve(cwd, file)) ? "present (values hidden)" : "not present"}`,
		);
	if (profile === "auth") {
		const file = resolve(cwd, options.envFile || ".dev.vars");
		const values = readEnv(file);
		authEnvironment(values as unknown as Bindings);
		const oauth = Boolean(
			values.GOOGLE_CLIENT_ID && values.GOOGLE_CLIENT_SECRET,
		);
		const mail = Boolean(
			(values.MAIL_FROM_EMAIL || values.MAIL_FROM) &&
				(values.RESEND_API_KEY ||
					(values.CLOUDFLARE_EMAIL_API_TOKEN && values.CLOUDFLARE_ACCOUNT_ID)),
		);
		if (!oauth && !mail)
			throw new Error(
				"No candidate login provider configuration. Configure Google OAuth or a verified mail sender/provider, then align websiteConfig auth/mail flags. Values are not displayed.",
			);
		log(
			"Auth secret/origin and candidate login configuration: present. Website feature flags, real OAuth, mail delivery and runtime /api/ready remain separate checks.",
		);
	}
	if (profile === "deploy") {
		const config = loadConfig(cwd, options);
		assertAccount(config, env);
		log(
			"Deployment account/credential configuration: present; no remote permission check without --check-auth.",
		);
	}
	if (options.checkAuth) {
		const config = loadConfig(cwd, options);
		const account = assertAccount(config, env);
		const api =
			dependencies.api || createCloudflareApi(account.accountId, account.token);
		await api.request("GET", "/d1/database?per_page=1");
		log(
			"Cloudflare D1 account access: OK (other permissions are checked per action)",
		);
		const result = await run(
			{
				executable: "gh",
				args: ["auth", "status", "--hostname", "github.com"],
				env: childEnvironment(env, {
					...(env.GH_TOKEN ? { GH_TOKEN: env.GH_TOKEN } : {}),
				}),
			},
			cwd,
		);
		if (result.code)
			throw new Error(
				"GitHub authentication is unavailable. Run gh auth login yourself.",
			);
		log("GitHub authentication: OK");
	}
	if (failures)
		throw new Error(
			`Doctor found ${failures} missing prerequisite(s). No tools were installed and no resources were changed.`,
		);
}
export async function runCli(
	options: Options,
	dependencies: Dependencies = {},
): Promise<void> {
	if (
		!options.execute ||
		["create", "doctor", "plan"].includes(options.command)
	)
		return runCliInternal(options, dependencies);
	const cwd = resolve(dependencies.cwd || process.cwd(), options.directory);
	const config = loadConfig(cwd, options);
	assertAuthorized(
		options,
		config.project,
		options.command === "delete" ? ["delete"] : stagesFor(options),
	);
	const lockDirectory = resolve(cwd, ".saas");
	mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
	const lockPath = resolve(lockDirectory, "execution.lock");
	let lock: number;
	try {
		lock = openSync(lockPath, "wx", 0o600);
	} catch {
		throw new Error(
			"Another setup process may be active. Inspect .saas/execution.lock and remove it only after confirming the previous process stopped.",
		);
	}
	writeFileSync(lock, String(process.pid));
	try {
		await runCliInternal(options, dependencies);
	} finally {
		closeSync(lock);
		unlinkSync(lockPath);
	}
}
async function runCliInternal(
	options: Options,
	dependencies: Dependencies = {},
): Promise<void> {
	const base = dependencies.cwd || process.cwd();
	const cwd = resolve(base, options.directory);
	const env = dependencies.env || process.env;
	const log = dependencies.log || console.log;
	const run = dependencies.run || runProcess;
	if (options.command === "doctor") return doctor(cwd, options, dependencies);
	if (options.command === "create") {
		if (!options.project) throw new Error("create requires a project name.");
		const config = defaultConfig(options.project, options);
		assertAuthorized(options, config.project, ["create"]);
		log(
			`Create independent starter at ${cwd === base ? base : cwd}. No secrets are generated; payment provisioning is manual.`,
		);
		if (!options.execute) {
			log("Dry run. No files, processes, or remote state were changed.");
			return;
		}
		if (cwd !== base) copyTemplate(base, cwd);
		const configPath = resolve(cwd, options.config);
		if (existsSync(configPath))
			throw new Error(
				"Setup configuration exists. Use plan/apply/resume instead.",
			);
		writeJson(configPath, config);
		for (const [source, target] of [
			[".env.example", ".env"],
			[".dev.vars.example", ".dev.vars"],
		])
			if (existsSync(resolve(cwd, source)) && !existsSync(resolve(cwd, target)))
				copyFileSync(resolve(cwd, source), resolve(cwd, target));
		log(
			"Local starter initialized. Review env files and run plan; no dependency installation or remote actions ran.",
		);
		return;
	}
	const config = loadConfig(cwd, options);
	if (!config.accountId && env.CLOUDFLARE_ACCOUNT_ID)
		config.accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const configPath = resolve(cwd, options.config);
	const statePath = resolve(cwd, options.state);
	const state = loadState(statePath, config);
	if (options.command === "delete")
		return deleteResources(options, config, state, statePath, {
			...dependencies,
			env,
			run,
			log,
		});
	const stages = stagesFor(options);
	if (!stages.length) throw new Error("No stages selected.");
	if (state.deleted && Object.keys(state.deleted).length)
		throw new Error(
			"This project has deleted-resource tombstones. Do not reprovision from a deletion journal; create a separately reviewed project/configuration.",
		);
	if (stages.includes("deploy") && !stages.includes("build"))
		throw new Error(
			"Deploy requires build in the same invocation to avoid shipping stale output. Select build,deploy.",
		);
	assertAuthorized(options, config.project, stages);
	const allCommands = new Map<Stage, ProcessCommand[]>();
	for (const stage of stages) {
		if (stage === "worker-secrets" || stage === "github-secrets") {
			if (!options.envFile)
				throw new Error(
					`${stage} requires --env-file. Files are never guessed and shell values are not bulk uploaded.`,
				);
			allCommands.set(
				stage,
				secretCommands(
					stage,
					config,
					options,
					readEnv(resolve(cwd, options.envFile)),
				),
			);
		} else allCommands.set(stage, stageCommands(stage, config));
	}
	for (const line of renderPlan(config, state, stages)) log(line);
	for (const [stage, commands] of allCommands)
		if (stage.endsWith("secrets"))
			for (const command of commands) {
				log(commandText(command));
				if (stage === "worker-secrets")
					log(
						`Runtime names: ${Object.keys(JSON.parse(command.input || "{}"))
							.sort()
							.join(", ")}`,
					);
			}
	if (!options.execute || options.command === "plan") {
		log(
			"Dry run. No processes ran, no network requests were sent, and no files were written.",
		);
		return;
	}
	const needsCloudflare = stages.some((stage) =>
		["provision", "migrate-remote", "deploy", "worker-secrets"].includes(stage),
	);
	const account = needsCloudflare ? assertAccount(config, env) : undefined;
	const api = needsCloudflare
		? dependencies.api ||
			createCloudflareApi(account?.accountId || "", account?.token || "")
		: undefined;
	const save = () => writeJson(statePath, state);
	if (
		state.pending &&
		!["provision", "install", "build", "migrate-local"].includes(
			state.pending.stage,
		)
	)
		throw new Error(
			`Previous ${state.pending.stage} operation has an uncertain outcome. Inspect that exact target and remove only the pending field from the local journal after reconciling it; no remote retry was attempted.`,
		);
	if (needsCloudflare && api)
		await api.request("GET", "/d1/database?per_page=1");
	if (
		stages.some((stage) => ["repo", "push", "github-secrets"].includes(stage))
	) {
		const auth = await run(
			{
				executable: "gh",
				args: ["auth", "status", "--hostname", "github.com"],
				env: childEnvironment(env, {
					...(env.GH_TOKEN ? { GH_TOKEN: env.GH_TOKEN } : {}),
				}),
			},
			cwd,
		);
		if (auth.code)
			throw new Error(
				"GitHub authentication failed. No GitHub changes were attempted.",
			);
	}
	for (const stage of stages) {
		if (stage === "provision") {
			if (!api) throw new Error("Missing Cloudflare API.");
			for (const kind of resources) {
				const wanted = config.resources[kind];
				const recorded = state.resources[kind];
				if (recorded) {
					await getResource(
						api,
						kind,
						recorded.id,
						recorded.name,
						recorded.ownership,
					);
					log(`${kind}: recorded resource verified`);
					continue;
				}
				if (wanted.id) {
					state.resources[kind] = await getResource(
						api,
						kind,
						wanted.id,
						wanted.name,
						"adopted",
					);
					if (
						state.pending?.stage === "provision" &&
						state.pending.kind === kind
					)
						delete state.pending;
					save();
					log(`${kind}: existing resource adopted (will not be deleted)`);
					continue;
				}
				if (options.command === "adopt")
					throw new Error(
						`adopt requires an exact existing ${kind} ID/name. No resource will be created.`,
					);
				if (state.pending?.stage === "provision")
					throw new Error(
						`A previous ${state.pending.kind} creation has an uncertain outcome. Inspect the account, then adopt the exact ID before resuming. No duplicate creation attempted.`,
					);
				const found = await findByName(api, kind, wanted.name);
				if (found.length)
					throw new Error(
						`${kind} name already exists. Explicitly adopt its exact ID; matching a name never grants ownership.`,
					);
				state.pending = { stage: "provision", kind, name: wanted.name };
				save();
				try {
					const result = await api.request(
						"POST",
						resourcePath(kind),
						kind === "kv" ? { title: wanted.name } : { name: wanted.name },
					);
					if (!isObject(result))
						throw new Error(
							`Invalid ${kind} creation result. Inspect before retrying.`,
						);
					const created = resourceFromResult(kind, result.result, "created");
					if (created.name !== wanted.name)
						throw new Error(
							"Provider returned an unexpected resource name. Inspect before retrying.",
						);
					state.resources[kind] = created;
					delete state.pending;
					save();
					log(`${kind}: created and recorded ${created.id}`);
				} catch (error) {
					if (error instanceof ProviderError && !error.uncertain) {
						delete state.pending;
						save();
					}
					throw error;
				}
			}
		} else if (stage === "configure")
			configureProject(cwd, config, state, configPath);
		else {
			if (["migrate-remote", "deploy", "worker-secrets"].includes(stage)) {
				assertBindings(cwd, config, state);
				if (api)
					for (const kind of resources) {
						const resource = state.resources[kind];
						if (resource)
							await getResource(
								api,
								kind,
								resource.id,
								resource.name,
								resource.ownership,
							);
					}
			}
			if (stage === "repo") {
				if (
					state.repositoryCreated &&
					state.repositoryCreated !== config.repository
				)
					throw new Error(
						"Recorded repository differs from the requested target.",
					);
				if (state.repositoryCreated === config.repository) {
					log(
						"Recorded repository creation already completed; no duplicate created.",
					);
					continue;
				}
				if (state.pending?.stage === "repo")
					throw new Error(
						"Repository creation outcome is uncertain. Inspect it with gh repo view before changing the local state.",
					);
			}
			if (stage === "push") await verifyPush(cwd, config, run, env);
			const publicBuild: EnvironmentValues = {};
			if (stage === "build") {
				const path = resolve(cwd, options.envFile || ".env.production");
				if (existsSync(path))
					Object.assign(publicBuild, splitEnvironment(readEnv(path)).public);
			}
			const additions: EnvironmentValues = stage === "build" ? publicBuild : {};
			if (
				["migrate-remote", "deploy", "worker-secrets"].includes(stage) &&
				account
			)
				Object.assign(additions, {
					CLOUDFLARE_ACCOUNT_ID: account.accountId,
					CLOUDFLARE_API_TOKEN: account.token,
				});
			if (["repo", "push", "github-secrets"].includes(stage) && env.GH_TOKEN)
				additions.GH_TOKEN = env.GH_TOKEN;
			state.pending = { stage };
			save();
			for (const command of allCommands.get(stage) || []) {
				log(`Running: ${commandText(command)}`);
				const commandEnv = childEnvironment(env, additions);
				if (command.verifyPublic?.value === null) {
					const before = await run(
						{
							executable: "gh",
							args: command.verifyPublic.args,
							env: commandEnv,
						},
						cwd,
					);
					if (publicVariableMatches(before, command.verifyPublic.key, null))
						continue;
				}
				const result = await run(
					{ ...command, env: childEnvironment(env, additions) },
					cwd,
				);
				if (result.code !== 0)
					throw new Error(
						`${stage} failed with exit code ${result.code}. Raw command output is suppressed to protect secrets. Inspect the target before retrying remote operations.`,
					);
				if (command.verifyPublic) {
					const verified = await run(
						{
							executable: "gh",
							args: command.verifyPublic.args,
							env: commandEnv,
						},
						cwd,
					);
					if (
						!publicVariableMatches(
							verified,
							command.verifyPublic.key,
							command.verifyPublic.value,
						)
					)
						throw new Error(
							"GitHub public variable read-back did not match. Outcome is uncertain; inspect the approved repository/environment before retrying.",
						);
				}
			}
			if (stage === "repo") state.repositoryCreated = config.repository;
			delete state.pending;
		}
		if (!state.completed.includes(stage)) state.completed.push(stage);
		save();
		log(`${stage}: complete`);
	}
	log(
		"Selected stages complete. Unselected migrations, secret uploads, repository pushes, and deployments did not run.",
	);
}
async function verifyPush(
	cwd: string,
	config: SetupConfig,
	run: ProcessRunner,
	env: NodeJS.ProcessEnv,
): Promise<void> {
	if (!config.repository) throw new Error("Push requires --repo owner/name.");
	const clean = childEnvironment(env, {
		...(env.GH_TOKEN ? { GH_TOKEN: env.GH_TOKEN } : {}),
	});
	const repository = await run(
		{
			executable: "gh",
			args: [
				"repo",
				"view",
				config.repository,
				"--json",
				"nameWithOwner,isPrivate",
			],
			env: clean,
		},
		cwd,
	);
	let info: unknown;
	try {
		info = JSON.parse(repository.stdout);
	} catch {
		throw new Error("Could not verify GitHub destination.");
	}
	if (
		repository.code ||
		!isObject(info) ||
		info.nameWithOwner !== config.repository ||
		info.isPrivate !== true
	)
		throw new Error(
			"Push destination must be the exact approved private repository.",
		);
	const status = await run(
		{ executable: "git", args: ["status", "--porcelain"], env: clean },
		cwd,
	);
	if (status.code || status.stdout.trim())
		throw new Error(
			"Push requires a clean, manually reviewed commit. The CLI never stages or commits files automatically.",
		);
	const files = await run(
		{ executable: "git", args: ["ls-files", "-z"], env: clean },
		cwd,
	);
	if (
		files.code ||
		files.stdout
			.split("\0")
			.filter(Boolean)
			.some((path) => !cleanTemplatePath(path))
	)
		throw new Error(
			"Tracked secret/generated files detected. Remove them and review git history before pushing.",
		);
}

async function deleteResources(
	options: Options,
	config: SetupConfig,
	state: SetupState,
	statePath: string,
	dependencies: Dependencies,
): Promise<void> {
	const log = dependencies.log || console.log;
	const owned = resources.filter(
		(kind) => state.resources[kind]?.ownership === "created",
	);
	const selected = options.deleteResources || owned;
	log(
		`Delete plan for ${config.project}, account ${config.accountId || "(missing)"}: ${selected.map((kind) => `${kind}:${state.resources[kind]?.id || state.deleted?.[kind]?.id || "(unrecorded)"}`).join(", ") || "(no CLI-owned resources)"}. Adopted resources, Worker, and GitHub repository are excluded.`,
	);
	log(
		"WARNING: D1 rows, KV keys, and empty R2 buckets will be permanently deleted. Back up first. R2 objects are never recursively emptied.",
	);
	if (!options.execute) return;
	assertAuthorized(options, config.project, ["delete"]);
	if (
		options.confirmDelete !== `DELETE ${config.project}` ||
		!options.deleteResources?.length
	)
		throw new Error(
			`Permanent deletion requires --delete-resources d1,r2,kv (select only intended kinds) and --confirm-delete "DELETE ${config.project}" in addition to --confirm and --allow delete.`,
		);
	for (const kind of selected) {
		const resource = state.resources[kind] || state.deleted?.[kind];
		if (resource?.ownership !== "created")
			throw new Error(
				`Refusing to delete ${kind}: it is unrecorded or adopted, not created by this CLI.`,
			);
	}
	if (state.pending && state.pending.stage !== "delete")
		throw new Error(
			"Resolve the existing uncertain operation before deleting resources.",
		);
	const account = assertAccount(config, dependencies.env || process.env);
	const api =
		dependencies.api || createCloudflareApi(account.accountId, account.token);
	// Validate every selected live resource before the first destructive request.
	for (const kind of selected) {
		const resource = state.resources[kind];
		if (!resource) continue;
		try {
			await getResource(api, kind, resource.id, resource.name, "created");
		} catch (error) {
			if (
				error instanceof ProviderError &&
				error.status === 404 &&
				state.pending?.stage === "delete" &&
				state.pending.kind === kind
			) {
				state.deleted ||= {};
				state.deleted[kind] = resource;
				delete state.resources[kind];
				delete state.pending;
				writeJson(statePath, state);
				log(`${kind}: prior deletion reconciled by exact-ID 404`);
			} else throw error;
		}
	}
	for (const kind of selected) {
		const resource = state.resources[kind];
		if (!resource) {
			log(`${kind}: already recorded as deleted`);
			continue;
		}
		state.pending = { stage: "delete", kind, name: resource.name };
		writeJson(statePath, state);
		try {
			await api.request("DELETE", resourcePath(kind, resource.id));
		} catch (error) {
			if (error instanceof ProviderError && !error.uncertain) {
				delete state.pending;
				writeJson(statePath, state);
			}
			throw error;
		}
		state.deleted ||= {};
		state.deleted[kind] = resource;
		delete state.resources[kind];
		delete state.pending;
		writeJson(statePath, state);
		log(`${kind}: permanently deleted exact recorded ID ${resource.id}`);
	}
	log(
		`Selected resource deletion complete for ${config.project}. Worker/repository were not deleted; remove them separately after reviewing ownership.`,
	);
}

/** Read-back applies only to public variables, never reads or deletes secret values. */
export function publicVariableMatches(
	result: RunResult,
	key: string,
	value: string | null,
): boolean {
	if (result.code !== 0)
		throw new Error(
			"Cannot verify GitHub public variables. Remote state is uncertain.",
		);
	let rows: unknown;
	try {
		rows = JSON.parse(result.stdout);
	} catch {
		throw new Error(
			"Invalid GitHub public variable response; remote state is uncertain.",
		);
	}
	if (
		!Array.isArray(rows) ||
		rows.some(
			(row) =>
				!isObject(row) ||
				typeof row.name !== "string" ||
				typeof row.value !== "string",
		)
	)
		throw new Error(
			"Invalid GitHub public variable response; remote state is uncertain.",
		);
	const matches = rows.filter((row) => row.name === key);
	return value === null
		? matches.length === 0
		: matches.length === 1 && matches[0].value === value;
}
