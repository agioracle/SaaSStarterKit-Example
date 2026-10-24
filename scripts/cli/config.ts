import {
	existsSync,
	readFileSync,
	mkdirSync,
	renameSync,
	writeFileSync,
	chmodSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export const STAGES = [
	"provision",
	"configure",
	"install",
	"migrate-local",
	"migrate-remote",
	"build",
	"deploy",
	"worker-secrets",
	"github-secrets",
	"repo",
	"push",
] as const;
export type Stage = (typeof STAGES)[number];
export type ResourceKind = "d1" | "r2" | "kv";
export interface Resource {
	id: string;
	name: string;
	ownership: "created" | "adopted";
}
export interface SetupConfig {
	schemaVersion: 1;
	project: string;
	accountId?: string;
	domain?: string;
	origin?: string;
	repository?: string;
	githubEnvironment?: string;
	payment: "none" | "manual";
	resources: {
		d1: { name: string; id?: string };
		r2: { name: string; id?: string };
		kv: { name: string; id?: string };
	};
}
export interface SetupState {
	schemaVersion: 1;
	project: string;
	accountId?: string;
	resources: Partial<Record<ResourceKind, Resource>>;
	completed: string[];
	deleted?: Partial<Record<ResourceKind, Resource>>;
	pending?: { stage: string; kind?: ResourceKind; name?: string };
	repositoryCreated?: string;
}
export interface Options {
	command: string;
	project?: string;
	execute: boolean;
	dryRun: boolean;
	confirm?: string;
	allow: string[];
	steps?: Stage[];
	directory: string;
	config: string;
	state: string;
	envFile?: string;
	domain?: string;
	origin?: string;
	accountId?: string;
	repo?: string;
	githubEnvironment?: string;
	payment?: string;
	databaseId?: string;
	bucket?: string;
	kvId?: string;
	checkAuth: boolean;
	profile?: "local-preview" | "auth" | "deploy";
	remote: boolean;
	confirmDelete?: string;
	deleteResources?: ResourceKind[];
	publicVars: boolean;
	clearPublic?: string[];
	credentials: boolean;
	runtimeSecrets: boolean;
	help: boolean;
}
const commands = [
	"create",
	"doctor",
	"plan",
	"apply",
	"resume",
	"adopt",
	"configure",
	"migrate",
	"build",
	"deploy",
	"sync-worker-secrets",
	"sync-github-secrets",
	"repo",
	"push",
	"delete",
];
const valueFlags = new Map([
	["--profile", "profile"],
	["--confirm-delete", "confirmDelete"],
	["--delete-resources", "deleteResources"],
	["--project", "project"],
	["--clear-public", "clearPublic"],
	["--confirm", "confirm"],
	["--allow", "allow"],
	["--steps", "steps"],
	["--directory", "directory"],
	["--config", "config"],
	["--state", "state"],
	["--env-file", "envFile"],
	["--domain", "domain"],
	["--origin", "origin"],
	["--account-id", "accountId"],
	["--repo", "repo"],
	["--github-environment", "githubEnvironment"],
	["--payment", "payment"],
	["--database-id", "databaseId"],
	["--bucket", "bucket"],
	["--kv-id", "kvId"],
]);
const booleanFlags = new Map([
	["--execute", "execute"],
	["--dry-run", "dryRun"],
	["--check-auth", "checkAuth"],
	["--remote", "remote"],
	["--public-vars", "publicVars"],
	["--credentials", "credentials"],
	["--runtime-secrets", "runtimeSecrets"],
	["--help", "help"],
	["-h", "help"],
]);
export function parseArgs(argv: string[]): Options {
	const result: Record<string, unknown> = {
		command: "plan",
		execute: false,
		dryRun: false,
		allow: [],
		directory: ".",
		config: ".saas/setup.json",
		state: ".saas/state.json",
		checkAuth: false,
		remote: false,
		publicVars: false,
		credentials: false,
		runtimeSecrets: false,
		help: false,
	};
	const args = [...argv];
	if (args[0] && !args[0].startsWith("-")) result.command = args.shift();
	if (!commands.includes(String(result.command)))
		throw new Error(`Unknown command: ${result.command}`);
	const seen = new Set<string>();
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (!arg.startsWith("-")) {
			if (result.project) throw new Error("Only one project name is accepted.");
			result.project = arg;
			continue;
		}
		if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
		seen.add(arg);
		const bool = booleanFlags.get(arg);
		if (bool) {
			result[bool] = true;
			continue;
		}
		const key = valueFlags.get(arg);
		if (!key)
			throw new Error(
				`Unknown option: ${arg}. Use --help. --yes is intentionally not supported.`,
			);
		const value = args[++index];
		if (!value || value.startsWith("--"))
			throw new Error(`Missing value for ${arg}`);
		result[key] =
			key === "allow" ||
			key === "steps" ||
			key === "deleteResources" ||
			key === "clearPublic"
				? value
						.split(",")
						.map((value) => value.trim())
						.filter(Boolean)
				: value;
	}
	if (result.execute && result.dryRun)
		throw new Error("--execute and --dry-run are mutually exclusive.");
	if (
		(result.steps as string[] | undefined)?.some(
			(stage) => !(STAGES as readonly string[]).includes(stage),
		)
	)
		throw new Error(`Unknown stage. Allowed: ${STAGES.join(", ")}`);
	if (
		(result.allow as string[]).some(
			(stage) => ![...STAGES, "delete", "create"].includes(stage as Stage),
		)
	)
		throw new Error("Unknown --allow capability. Wildcards are not supported.");
	if (
		(result.deleteResources as string[] | undefined)?.some(
			(kind) => !["d1", "r2", "kv"].includes(kind),
		)
	)
		throw new Error("Only d1,r2,kv are supported deletion targets.");
	if (
		result.profile &&
		!["local-preview", "auth", "deploy"].includes(String(result.profile))
	)
		throw new Error("Doctor profile must be local-preview, auth, or deploy.");
	return result as unknown as Options;
}
export function isObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validName(value: string): boolean {
	return /^[a-z][a-z0-9-]{1,50}[a-z0-9]$/.test(value);
}
export function validateConfig(input: unknown): SetupConfig {
	if (
		!isObject(input) ||
		input.schemaVersion !== 1 ||
		typeof input.project !== "string" ||
		!validName(input.project)
	)
		throw new Error(
			"Configuration requires schemaVersion 1 and a 3–52 character lowercase project name.",
		);
	for (const key of Object.keys(input))
		if (
			![
				"schemaVersion",
				"project",
				"accountId",
				"domain",
				"origin",
				"repository",
				"githubEnvironment",
				"payment",
				"resources",
			].includes(key)
		)
			throw new Error(
				`Unknown setup configuration key: ${key}. Never store secrets in setup.json.`,
			);
	for (const key of [
		"accountId",
		"domain",
		"origin",
		"repository",
		"githubEnvironment",
	])
		if (input[key] !== undefined && typeof input[key] !== "string")
			throw new Error(`Invalid ${key}`);
	if (input.accountId && !/^[a-f0-9]{32}$/i.test(String(input.accountId)))
		throw new Error("accountId must be a 32-character Cloudflare account ID.");
	if (
		input.domain &&
		!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(
			String(input.domain),
		)
	)
		throw new Error(
			"Use an exact hostname for --domain, not a URL, wildcard, or path.",
		);
	if (input.origin) {
		let url: URL;
		try {
			url = new URL(String(input.origin));
		} catch {
			throw new Error("origin must be an HTTPS origin.");
		}
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			url.pathname !== "/"
		)
			throw new Error(
				"origin must be an HTTPS origin without credentials, query, or path.",
			);
		input.origin = url.origin;
	}
	if (
		input.domain &&
		input.origin &&
		new URL(String(input.origin)).hostname !== input.domain
	)
		throw new Error("domain and origin must identify the same host.");
	if (
		input.repository &&
		!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(
			String(input.repository),
		)
	)
		throw new Error("repository must be owner/name.");
	if (
		input.githubEnvironment &&
		!/^[a-zA-Z0-9_-]{1,64}$/.test(String(input.githubEnvironment))
	)
		throw new Error("Invalid GitHub environment name.");
	if (!["none", "manual"].includes(String(input.payment)))
		throw new Error(
			"payment must be none or manual. Automatic Waffo account/product provisioning is not implemented; configure your own sandbox manually.",
		);
	if (
		!isObject(input.resources) ||
		Object.keys(input.resources).some(
			(key) => !["d1", "r2", "kv"].includes(key),
		)
	)
		throw new Error("resources must contain only d1, r2, and kv.");
	for (const kind of ["d1", "r2", "kv"] as const) {
		const value = input.resources[kind];
		if (
			!isObject(value) ||
			typeof value.name !== "string" ||
			!validName(value.name) ||
			Object.keys(value).some((key) => !["name", "id"].includes(key))
		)
			throw new Error(`Invalid ${kind} resource configuration.`);
		if (kind === "r2" && value.name.length > 63)
			throw new Error("R2 bucket name is too long.");
		if (
			value.id !== undefined &&
			(typeof value.id !== "string" || !validId(kind, value.id))
		)
			throw new Error(`Invalid ${kind} resource ID.`);
		if (kind === "r2" && value.id && value.id !== value.name)
			throw new Error("An R2 resource ID is its exact bucket name.");
	}
	return input as unknown as SetupConfig;
}
export function validId(kind: ResourceKind, id: string): boolean {
	return kind === "d1"
		? /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
		: kind === "kv"
			? /^[a-f0-9]{32}$/i.test(id)
			: /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(id);
}
export function defaultConfig(
	project: string,
	options: Partial<Options> = {},
): SetupConfig {
	return validateConfig({
		schemaVersion: 1,
		project,
		accountId: options.accountId,
		domain: options.domain,
		origin:
			options.origin ||
			(options.domain ? `https://${options.domain}` : undefined),
		repository: options.repo,
		githubEnvironment: options.githubEnvironment,
		payment: options.payment || "none",
		resources: {
			d1: { name: `${project}-db`, id: options.databaseId },
			r2: { name: options.bucket || `${project}-files`, id: options.bucket },
			kv: { name: `${project}-cache`, id: options.kvId },
		},
	});
}
// A character-state parser avoids stripping comment-like text from URLs or quoted strings.
export function parseJsonc(source: string): unknown {
	let result = "";
	let quote = false;
	let escaped = false;
	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		if (quote) {
			result += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') quote = false;
			continue;
		}
		if (char === '"') {
			quote = true;
			result += char;
			continue;
		}
		if (char === "/" && source[i + 1] === "/") {
			while (i < source.length && source[i] !== "\n") i++;
			result += "\n";
			continue;
		}
		if (char === "/" && source[i + 1] === "*") {
			i += 2;
			while (i < source.length && !(source[i] === "*" && source[i + 1] === "/"))
				i++;
			if (i >= source.length) throw new Error("Unterminated JSONC comment.");
			i++;
			result += " ";
			continue;
		}
		if (char === ",") {
			let j = i + 1;
			while (/\s/.test(source[j] || "") && j < source.length) j++;
			if (source[j] === "}" || source[j] === "]") continue;
		}
		result += char;
	}
	// Trailing commas immediately before a removed comment need a second pass.
	if (result !== source && /,\s*[}\]]/.test(result)) return parseJsonc(result);
	try {
		return JSON.parse(result);
	} catch {
		throw new Error("Invalid JSON/JSONC configuration.");
	}
}
export function readJson(path: string): unknown {
	return parseJsonc(readFileSync(path, "utf8"));
}
export function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
		mode: 0o600,
		flag: "wx",
	});
	renameSync(temporary, path);
	chmodSync(path, 0o600);
}
export function loadConfig(cwd: string, options: Options): SetupConfig {
	const path = resolve(cwd, options.config);
	if (!existsSync(path)) {
		if (!options.project)
			throw new Error(
				"Missing setup configuration. Run create <project> first or pass a project name.",
			);
		return defaultConfig(options.project, options);
	}
	const config = validateConfig(readJson(path));
	if (options.project && options.project !== config.project)
		throw new Error("Project does not match setup configuration.");
	const overrides = {
		...config,
		accountId: options.accountId || config.accountId,
		domain: options.domain || config.domain,
		origin:
			options.origin ||
			(options.domain ? `https://${options.domain}` : config.origin),
		repository: options.repo || config.repository,
		githubEnvironment: options.githubEnvironment || config.githubEnvironment,
		payment: options.payment || config.payment,
		resources: {
			d1: {
				...config.resources.d1,
				id: options.databaseId || config.resources.d1.id,
			},
			r2: options.bucket
				? { name: options.bucket, id: options.bucket }
				: config.resources.r2,
			kv: {
				...config.resources.kv,
				id: options.kvId || config.resources.kv.id,
			},
		},
	};
	return validateConfig(overrides);
}
export function loadState(path: string, config: SetupConfig): SetupState {
	if (!existsSync(path))
		return {
			schemaVersion: 1,
			project: config.project,
			accountId: config.accountId,
			resources: {},
			completed: [],
		};
	const state = readJson(path);
	if (
		!isObject(state) ||
		state.schemaVersion !== 1 ||
		state.project !== config.project ||
		state.accountId !== config.accountId ||
		!isObject(state.resources) ||
		!Array.isArray(state.completed) ||
		state.completed.some(
			(value) =>
				typeof value !== "string" ||
				!(STAGES as readonly string[]).includes(value),
		)
	)
		throw new Error(
			"State schema, project, or account does not match. Do not reuse another project’s state.",
		);
	if (
		Object.keys(state).some(
			(key) =>
				![
					"schemaVersion",
					"project",
					"accountId",
					"resources",
					"deleted",
					"completed",
					"pending",
					"repositoryCreated",
				].includes(key),
		)
	)
		throw new Error(
			"Unexpected state field. State must never contain secret values.",
		);
	if (state.deleted !== undefined && !isObject(state.deleted))
		throw new Error("Invalid deleted-resource journal.");
	for (const [kind, resource] of Object.entries({
		...state.resources,
		...(isObject(state.deleted) ? state.deleted : {}),
	})) {
		if (
			!["d1", "r2", "kv"].includes(kind) ||
			!isObject(resource) ||
			typeof resource.id !== "string" ||
			!validId(kind as ResourceKind, resource.id) ||
			resource.name !== config.resources[kind as ResourceKind].name ||
			!["created", "adopted"].includes(String(resource.ownership)) ||
			Object.keys(resource).some(
				(key) => !["id", "name", "ownership"].includes(key),
			)
		)
			throw new Error(`Invalid recorded resource: ${kind}`);
		if (
			config.resources[kind as ResourceKind].id &&
			resource.id !== config.resources[kind as ResourceKind].id
		)
			throw new Error(`Configured and recorded ${kind} IDs disagree.`);
	}
	if (
		state.repositoryCreated !== undefined &&
		state.repositoryCreated !== config.repository
	)
		throw new Error(
			"Recorded repository does not match the configured repository.",
		);
	if (
		state.pending &&
		(!isObject(state.pending) ||
			typeof state.pending.stage !== "string" ||
			![...STAGES, "delete"].includes(state.pending.stage as Stage) ||
			Object.keys(state.pending).some(
				(key) => !["stage", "kind", "name"].includes(key),
			))
	)
		throw new Error("Invalid pending operation record.");
	if (
		isObject(state.pending) &&
		((state.pending.kind !== undefined &&
			!["d1", "r2", "kv"].includes(String(state.pending.kind))) ||
			(state.pending.name !== undefined &&
				(typeof state.pending.name !== "string" ||
					!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(state.pending.name))))
	)
		throw new Error("Invalid pending resource identity.");
	return state as unknown as SetupState;
}
