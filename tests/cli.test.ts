import { afterEach, describe, expect, it, vi } from "vitest";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	existsSync,
	rmSync,
	symlinkSync,
	readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultConfig,
	loadState,
	parseArgs,
	parseJsonc,
	validateConfig,
	writeJson,
	type SetupState,
	type ResourceKind,
} from "../scripts/cli/config";
import {
	assertAuthorized,
	commandText,
	configureProject,
	copyTemplate,
	runCli,
	secretCommands,
	stageCommands,
	stagesFor,
	type ProcessCommand,
} from "../scripts/cli/runner";
import {
	assertAccount,
	createCloudflareApi,
	findByName,
	getResource,
	ProviderError,
	resourcePath,
	type CloudflareApi,
} from "../scripts/cli/provider";
import { databasePushPlan, runDatabasePush } from "../scripts/db-push";
import { findLocalDatabase, studioPlan, runStudio } from "../scripts/db-studio";
import { authSchemaCommand, runAuthSchema } from "../scripts/auth-schema";
import {
	childEnvironment,
	parseEnv,
	redact,
	splitEnvironment,
} from "../scripts/cli/secrets";

const account = "a".repeat(32);
const database = "11111111-2222-3333-4444-555555555555";
const namespace = "b".repeat(32);
const roots: string[] = [];
const shell = {
	PATH: process.env.PATH,
	CLOUDFLARE_ACCOUNT_ID: account,
	CLOUDFLARE_API_TOKEN: "deployment-token-test-value",
	GH_TOKEN: "github-token-test-value",
	BETTER_AUTH_SECRET: "never-inherit-this-secret",
};
const config = () =>
	defaultConfig("example-app", {
		accountId: account,
		origin: "https://example.com",
		repo: "example/example-app",
	});
function stateFor(value = config()): SetupState {
	return {
		schemaVersion: 1,
		project: value.project,
		accountId: value.accountId,
		completed: [],
		resources: {
			d1: { id: database, name: value.resources.d1.name, ownership: "created" },
			r2: {
				id: value.resources.r2.name,
				name: value.resources.r2.name,
				ownership: "created",
			},
			kv: {
				id: namespace,
				name: value.resources.kv.name,
				ownership: "created",
			},
		},
	};
}
function fixture(value = config()): string {
	const root = mkdtempSync(join(tmpdir(), "saas-cli-test-"));
	roots.push(root);
	writeFileSync(
		join(root, "wrangler.jsonc"),
		'{"name":"starter","main":"entry.ts","compatibility_date":"2026-10-01","vars":{"CUSTOM":"keep"}}',
	);
	mkdirSync(join(root, ".saas"));
	writeJson(join(root, ".saas/setup.json"), value);
	return root;
}
function apiMock(value = config()) {
	return {
		request: vi.fn<CloudflareApi["request"]>(async (method, path, input) => {
			const body = input as Record<string, string> | undefined;
			const kind: ResourceKind = path.startsWith("/d1/")
				? "d1"
				: path.startsWith("/r2/")
					? "r2"
					: "kv";
			const id =
				kind === "d1"
					? database
					: kind === "r2"
						? value.resources.r2.name
						: namespace;
			const data =
				kind === "d1"
					? { uuid: id, name: value.resources.d1.name }
					: kind === "r2"
						? { name: id }
						: { id, title: value.resources.kv.name };
			if (method === "POST")
				return {
					success: true,
					result:
						kind === "kv"
							? { ...data, title: body?.title }
							: { ...data, name: body?.name },
				};
			if (path.includes("?"))
				return {
					success: true,
					result: kind === "r2" ? { buckets: [] } : [],
					result_info: { total_pages: 1 },
				};
			return { success: true, result: data };
		}),
	};
}
function execOptions(command: string, allow: string) {
	return parseArgs([
		command,
		"--execute",
		"--confirm",
		"example-app",
		"--allow",
		allow,
	]);
}
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("CLI arguments and scope", () => {
	it("defaults to a side-effect-free plan and does not accept blanket approval", () => {
		expect(parseArgs([]).execute).toBe(false);
		expect(parseArgs([]).command).toBe("plan");
		expect(() => parseArgs(["apply", "--yes"])).toThrow("Unknown option");
		expect(() => parseArgs(["apply", "--allow", "*"])).toThrow("Unknown");
	});
	it.each([
		["apply", "--execute", "--dry-run"],
		["apply", "--repo"],
		["apply", "--nonsense"],
		["apply", "--steps", "delete"],
		["apply", "--repo", "a/b", "--repo", "c/d"],
		["bogus"],
	])("rejects invalid args %j", (...args) =>
		expect(() => parseArgs(args)).toThrow(),
	);
	it("requires exact project confirmation and all selected capabilities", () => {
		expect(() =>
			assertAuthorized(parseArgs(["deploy", "--execute"]), "example-app", [
				"build",
				"deploy",
			]),
		).toThrow("--confirm");
		expect(() =>
			assertAuthorized(execOptions("deploy", "deploy"), "example-app", [
				"build",
				"deploy",
			]),
		).toThrow("build");
		expect(() =>
			assertAuthorized(execOptions("deploy", "build,deploy"), "example-app", [
				"build",
				"deploy",
			]),
		).not.toThrow();
	});
	it("orders explicit stages and never implicitly deploys on apply", () => {
		expect(stagesFor(parseArgs(["apply"]))).toEqual(["provision", "configure"]);
		expect(
			stagesFor(parseArgs(["apply", "--steps", "deploy,build,migrate-remote"])),
		).toEqual(["migrate-remote", "build", "deploy"]);
		expect(stagesFor(parseArgs(["migrate"]))).toEqual(["migrate-local"]);
		expect(stagesFor(parseArgs(["migrate", "--remote"]))).toEqual([
			"migrate-remote",
		]);
	});
	it("requires explicit supported payment configuration", () =>
		expect(() => defaultConfig("example-app", { payment: "waffo" })).toThrow(
			"not implemented",
		));
	it("requires a known config/project rather than guessing a target", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "saas-cli-empty-"));
		roots.push(cwd);
		await expect(
			runCli(parseArgs(["apply"]), { cwd, env: {}, log: vi.fn() }),
		).rejects.toThrow("Missing setup");
	});
	it("does not treat execute on plan as permission to run anything", async () => {
		const cwd = fixture();
		const api = apiMock();
		const run = vi.fn();
		const before = readdirSync(join(cwd, ".saas"));
		await runCli(execOptions("plan", "provision,configure"), {
			cwd,
			env: shell,
			api,
			run,
			log: vi.fn(),
		});
		expect(api.request).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
		expect(readdirSync(join(cwd, ".saas"))).toEqual(before);
	});
});

describe("configuration/state parsing", () => {
	it("supports JSONC comments/trailing commas without damaging URL strings", () => {
		expect(
			parseJsonc(
				'{/*c*/"url":"https://example.com/a//b", "text":"/*literal*/", // c\n "list":[1,2,],}',
			),
		).toEqual({
			url: "https://example.com/a//b",
			text: "/*literal*/",
			list: [1, 2],
		});
		expect(parseJsonc('{"a":1, /* final */}')).toEqual({ a: 1 });
	});
	it("rejects broken JSONC", () => {
		expect(() => parseJsonc("{/*")).toThrow();
		expect(() => parseJsonc("{broken}")).toThrow();
	});
	it.each([
		"bad/name",
		"Uppercase",
		"ab",
		"has space",
		"-leading",
		"trailing-",
	])("rejects unsafe project %s", (name) =>
		expect(() => defaultConfig(name)).toThrow(),
	);
	it.each([
		"https://bad.example",
		"*.example.com",
		"bad.example/path",
		"localhost",
	])("rejects unsafe domain %s", (domain) =>
		expect(() => defaultConfig("example-app", { domain })).toThrow(),
	);
	it.each([
		"http://example.com",
		"https://a:b@example.com",
		"https://example.com/path",
		"https://example.com?q=token",
	])("rejects unsafe origin %s", (origin) =>
		expect(() => defaultConfig("example-app", { origin })).toThrow(),
	);
	it("rejects secrets and unknown fields in setup config", () =>
		expect(() =>
			validateConfig({ ...config(), CLOUDFLARE_API_TOKEN: "nope" }),
		).toThrow("Never store secrets"));
	it("rejects resource mismatches and cross-account state", () => {
		const cwd = fixture();
		const state = stateFor();
		writeJson(join(cwd, ".saas/state.json"), state);
		expect(() =>
			loadState(join(cwd, ".saas/state.json"), {
				...config(),
				accountId: "c".repeat(32),
			}),
		).toThrow("account");
		if (state.resources.d1) state.resources.d1.name = "someone-elses-db";
		writeJson(join(cwd, ".saas/state.json"), state);
		expect(() => loadState(join(cwd, ".saas/state.json"), config())).toThrow(
			"resource",
		);
	});
	it("rejects arbitrary secret-valued fields in state", () => {
		const cwd = fixture();
		writeJson(join(cwd, ".saas/state.json"), {
			...stateFor(),
			secret: "must-not-save",
		});
		expect(() => loadState(join(cwd, ".saas/state.json"), config())).toThrow(
			"secret",
		);
	});
	it("writes verified bindings while preserving unrelated config", () => {
		const cwd = fixture();
		configureProject(cwd, config(), stateFor(), join(cwd, ".saas/setup.json"));
		const value = JSON.parse(readFileSync(join(cwd, "wrangler.jsonc"), "utf8"));
		expect(value.name).toBe("example-app");
		expect(value.main).toBe("entry.ts");
		expect(value.vars.CUSTOM).toBe("keep");
		expect(value.d1_databases[0].database_id).toBe(database);
		expect(value.r2_buckets[0].binding).toBe("BUCKET");
		expect(value.kv_namespaces[0].binding).toBe("CACHE");
		expect(existsSync(join(cwd, "wrangler.jsonc.backup"))).toBe(true);
		expect(readFileSync(join(cwd, ".env.production"), "utf8")).toBe(
			'VITE_BASE_URL="https://example.com"\nVITE_APP_URL="https://example.com"\nVITE_PAYMENT_PROVIDER="none"\n',
		);
	});
	it.each(["none", "manual"] as const)(
		"reconciles payment %s and canonical origin instead of leaving stale build settings",
		(payment) => {
			const cwd = fixture();
			writeFileSync(
				join(cwd, ".env.production"),
				'VITE_PAYMENT_PROVIDER="stripe"\nVITE_BASE_URL="https://old.example.test"\n',
			);
			configureProject(
				cwd,
				{ ...config(), payment },
				stateFor(),
				join(cwd, ".saas/setup.json"),
			);
			const values = readFileSync(join(cwd, ".env.production"), "utf8");
			expect(values).toContain('VITE_BASE_URL="https://example.com"');
			expect(values).toContain(
				`VITE_PAYMENT_PROVIDER="${payment === "none" ? "none" : "stripe"}"`,
			);
		},
	);

	it("refuses mixed secret/public build files without overwriting Wrangler", () => {
		const cwd = fixture();
		const before = readFileSync(join(cwd, "wrangler.jsonc"), "utf8");
		writeFileSync(
			join(cwd, ".env.production"),
			"STRIPE_SECRET_KEY=secret-value",
		);
		expect(() =>
			configureProject(
				cwd,
				config(),
				stateFor(),
				join(cwd, ".saas/setup.json"),
			),
		).toThrow("public build");
		expect(readFileSync(join(cwd, "wrangler.jsonc"), "utf8")).toBe(before);
	});
	it("rejects named environments rather than accidentally deploy to root", () => {
		const cwd = fixture();
		writeFileSync(join(cwd, "wrangler.jsonc"), '{"env":{"production":{}}}');
		expect(() =>
			configureProject(
				cwd,
				config(),
				stateFor(),
				join(cwd, ".saas/setup.json"),
			),
		).toThrow("Named Wrangler");
	});
});

describe("environment/secret separation", () => {
	it("parses dotenv without executing/interpolating values, including multiline keys", () => {
		expect(
			parseEnv(
				"export A=\"first\\nsecond\"\nB=literal$(evil) # comment\nC='first\nsecond'",
			),
		).toEqual({ A: "first\nsecond", B: "literal$(evil)", C: "first\nsecond" });
	});
	it.each(["A=x\nA=y", "bad key=secret", 'A="unclosed', 'A="x"bad'])(
		"rejects malformed dotenv without showing values",
		(text) => expect(() => parseEnv(text)).toThrow(),
	);
	it("classifies a non-secret dual-use account ID but never a broad API token as runtime", () => {
		const split = splitEnvironment({
			VITE_APP_URL: "https://example.com",
			BETTER_AUTH_SECRET: "x".repeat(40),
			CLOUDFLARE_API_TOKEN: "token",
			CLOUDFLARE_ACCOUNT_ID: account,
			FEISHU_WEBHOOK_SECRET: "webhook",
		});
		expect(split.runtime.CLOUDFLARE_API_TOKEN).toBeUndefined();
		expect(split.runtime.CLOUDFLARE_ACCOUNT_ID).toBe(account);
		expect(split.deployment.CLOUDFLARE_ACCOUNT_ID).toBe(account);
		expect(split.public).toEqual({ VITE_APP_URL: "https://example.com" });
		expect(split.runtime.FEISHU_WEBHOOK_SECRET).toBe("webhook");
	});
	it.each([
		"VITE_SECRET_KEY",
		"UNREVIEWED_KEY",
		"MAILCHEAP_LIST_ID",
		"WAFFO_WEBHOOK_SECRET",
	])("rejects non-allowlisted %s", (key) =>
		expect(() => splitEnvironment({ [key]: "value" })).toThrow("allowlisted"),
	);
	it("does not upload placeholder authentication secrets", () =>
		expect(() =>
			splitEnvironment({ BETTER_AUTH_SECRET: "change-me-example".repeat(4) }),
		).toThrow("non-placeholder"));
	it("Worker upload sends runtime JSON on stdin, never argv/public/CI token", () => {
		const command = secretCommands("worker-secrets", config(), parseArgs([]), {
			STRIPE_SECRET_KEY: "stripe-secret",
			VITE_APP_URL: "https://example.com",
			CLOUDFLARE_API_TOKEN: "deploy-secret",
		})[0];
		expect(command.args).toContain("bulk");
		expect(JSON.parse(command.input || "{}")).toEqual({
			STRIPE_SECRET_KEY: "stripe-secret",
		});
		expect(commandText(command)).not.toContain("stripe-secret");
		expect(commandText(command)).toContain("[redacted stdin]");
	});
	it("GitHub sync uses selected categories, exact repository/environment, and stdin", () => {
		const options = parseArgs([
			"sync-github-secrets",
			"--public-vars",
			"--credentials",
		]);
		const commands = secretCommands(
			"github-secrets",
			{ ...config(), githubEnvironment: "production" },
			options,
			{
				VITE_APP_URL: "https://example.com",
				CLOUDFLARE_API_TOKEN: "deploy-secret",
				CLOUDFLARE_ACCOUNT_ID: account,
				STRIPE_SECRET_KEY: "not-selected",
			},
		);
		expect(commands).toHaveLength(3);
		expect(commands[0].args).toEqual([
			"variable",
			"set",
			"VITE_APP_URL",
			"--repo",
			"example/example-app",
			"--env",
			"production",
		]);
		expect(commands[1].args.slice(0, 3)).toEqual([
			"secret",
			"set",
			"CLOUDFLARE_API_TOKEN",
		]);
		expect(commands[2].args[0]).toBe("variable");
		expect(JSON.stringify(commands)).not.toContain("not-selected");
	});
	it("requires an explicit GitHub category and rejects account mismatch", () => {
		expect(() =>
			secretCommands("github-secrets", config(), parseArgs([]), {
				VITE_APP_URL: "url",
			}),
		).toThrow("Select GitHub");
		expect(() =>
			secretCommands("worker-secrets", config(), parseArgs([]), {
				CLOUDFLARE_ACCOUNT_ID: "c".repeat(32),
			}),
		).toThrow("differs");
	});
	it("does not inherit unrelated credentials into child processes", () => {
		const value = childEnvironment(
			{
				...shell,
				HOME: "/tmp",
				NODE_OPTIONS: "--import malicious",
				STRIPE_SECRET_KEY: "stripe",
			},
			{ VITE_APP_URL: "https://example.com" },
		);
		expect(value.CLOUDFLARE_API_TOKEN).toBeUndefined();
		expect(value.GH_TOKEN).toBeUndefined();
		expect(value.BETTER_AUTH_SECRET).toBeUndefined();
		expect(value.NODE_OPTIONS).toBeUndefined();
		expect(value.VITE_APP_URL).toBe("https://example.com");
	});
	it("redacts full values before shorter partial values", () =>
		expect(redact("long-token token", { A: "token", B: "long-token" })).toBe(
			"[REDACTED] [REDACTED]",
		));
});

describe("process command contracts", () => {
	it("separates local migration, remote migration, build, and deploy", () => {
		expect(stageCommands("migrate-local", config())[0].args).toContain(
			"--local",
		);
		expect(stageCommands("migrate-local", config())[0].args).not.toContain(
			"--remote",
		);
		expect(stageCommands("migrate-remote", config())[0].args).toContain(
			"--remote",
		);
		expect(stageCommands("build", config())).toEqual([
			{ executable: "npm", args: ["run", "build"] },
		]);
		expect(stageCommands("deploy", config())[0].args).toEqual([
			"--no-install",
			"wrangler",
			"deploy",
		]);
	});
	it("creates private repos without implicit push/commit and pushes exact HEAD only", () => {
		expect(stageCommands("repo", config())[0].args).toEqual([
			"repo",
			"create",
			"example/example-app",
			"--private",
		]);
		expect(stageCommands("push", config())[0].args).toEqual([
			"push",
			"https://github.com/example/example-app.git",
			"HEAD:refs/heads/main",
		]);
	});
	it("dry-run never executes a process, calls provider, writes state or config", async () => {
		const cwd = fixture();
		const api = apiMock();
		const run = vi.fn();
		const log = vi.fn();
		const before = readFileSync(join(cwd, "wrangler.jsonc"), "utf8");
		await runCli(parseArgs(["apply"]), { cwd, env: shell, api, run, log });
		expect(api.request).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
		expect(existsSync(join(cwd, ".saas/state.json"))).toBe(false);
		expect(readFileSync(join(cwd, "wrangler.jsonc"), "utf8")).toBe(before);
		expect(log.mock.calls.flat().join("\n")).toContain("Dry run");
	});
	it("fails missing credentials before invoking the provider/process", async () => {
		const cwd = fixture();
		const api = apiMock();
		const run = vi.fn();
		await expect(
			runCli(execOptions("apply", "provision,configure"), {
				cwd,
				env: {},
				api,
				run,
				log: vi.fn(),
			}),
		).rejects.toThrow("CLOUDFLARE_API_TOKEN");
		expect(api.request).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
	});
	it("requires build with deployment and stops before any remote call", async () => {
		const cwd = fixture();
		const api = apiMock();
		await expect(
			runCli(parseArgs(["apply", "--steps", "deploy"]), {
				cwd,
				env: shell,
				api,
				log: vi.fn(),
			}),
		).rejects.toThrow("build in the same");
		expect(api.request).not.toHaveBeenCalled();
	});
	it("runs local migration without Cloudflare credentials and strips shell secrets", async () => {
		const cwd = fixture();
		const run = vi.fn(async (_command: ProcessCommand) => ({
			stdout: "",
			stderr: "",
			code: 0,
		}));
		const api = apiMock();
		await runCli(execOptions("migrate", "migrate-local"), {
			cwd,
			env: shell,
			run,
			api,
			log: vi.fn(),
		});
		expect(api.request).not.toHaveBeenCalled();
		expect(run).toHaveBeenCalledOnce();
		expect(run.mock.calls[0][0].env?.CLOUDFLARE_API_TOKEN).toBeUndefined();
	});
	it("suppresses child output and persists an uncertain remote outcome", async () => {
		const cwd = fixture();
		const state = stateFor();
		writeJson(join(cwd, ".saas/state.json"), state);
		configureProject(cwd, config(), state, join(cwd, ".saas/setup.json"));
		const run = vi.fn(async (command: ProcessCommand) => ({
			stdout: "raw-secret-value",
			stderr: "raw-secret-value",
			code: command.args.includes("deploy") ? 1 : 0,
		}));
		const log = vi.fn();
		await expect(
			runCli(execOptions("deploy", "build,deploy"), {
				cwd,
				env: shell,
				run,
				api: apiMock(),
				log,
			}),
		).rejects.toThrow("exit code 1");
		expect(log.mock.calls.flat().join("\n")).not.toContain("raw-secret-value");
		expect(
			loadState(join(cwd, ".saas/state.json"), config()).pending?.stage,
		).toBe("deploy");
	});
	it("prevents concurrent executions and retains another process lock", async () => {
		const cwd = fixture();
		writeFileSync(join(cwd, ".saas/execution.lock"), "123");
		const run = vi.fn();
		await expect(
			runCli(execOptions("build", "build"), {
				cwd,
				env: {},
				run,
				log: vi.fn(),
			}),
		).rejects.toThrow("Another setup");
		expect(run).not.toHaveBeenCalled();
		expect(readFileSync(join(cwd, ".saas/execution.lock"), "utf8")).toBe("123");
	});
});

describe("provisioning and resumability (mock provider only)", () => {
	it("creates D1/R2/KV once, records IDs not secrets, and verifies them on resume", async () => {
		const cwd = fixture();
		const api = apiMock();
		const deps = { cwd, env: shell, api, run: vi.fn(), log: vi.fn() };
		await runCli(execOptions("apply", "provision,configure"), deps);
		expect(
			api.request.mock.calls.filter((call) => call[0] === "POST"),
		).toHaveLength(3);
		const saved = readFileSync(join(cwd, ".saas/state.json"), "utf8");
		expect(saved).not.toContain("token");
		expect(saved).not.toContain("SECRET");
		expect(JSON.parse(saved).resources.d1.ownership).toBe("created");
		api.request.mockClear();
		await runCli(execOptions("resume", "provision,configure"), deps);
		expect(
			api.request.mock.calls.filter((call) => call[0] === "POST"),
		).toHaveLength(0);
		expect(
			api.request.mock.calls.filter((call) => call[0] === "GET").length,
		).toBeGreaterThan(2);
	});
	it("explicitly adopts exact IDs without creating resources", async () => {
		const value = config();
		value.resources.d1.id = database;
		value.resources.r2.id = value.resources.r2.name;
		value.resources.kv.id = namespace;
		const cwd = fixture(value);
		const api = apiMock(value);
		await runCli(execOptions("adopt", "provision,configure"), {
			cwd,
			env: shell,
			api,
			log: vi.fn(),
		});
		expect(api.request.mock.calls.some((call) => call[0] === "POST")).toBe(
			false,
		);
		expect(
			loadState(join(cwd, ".saas/state.json"), value).resources.d1?.ownership,
		).toBe("adopted");
	});
	it("refuses a matching preexisting name instead of claiming it", async () => {
		const cwd = fixture();
		const api = apiMock();
		api.request.mockImplementation(async () => ({
			success: true,
			result: [{ uuid: database, name: "example-app-db" }],
			result_info: { total_pages: 1 },
		}));
		await expect(
			runCli(execOptions("apply", "provision,configure"), {
				cwd,
				env: shell,
				api,
				log: vi.fn(),
			}),
		).rejects.toThrow("Explicitly adopt");
		expect(api.request.mock.calls.some((call) => call[0] === "POST")).toBe(
			false,
		);
	});
	it("records an uncertain POST outcome and refuses blind creation retries", async () => {
		const cwd = fixture();
		const api = apiMock();
		const original = api.request.getMockImplementation();
		if (!original) throw new Error("missing mock");
		api.request.mockImplementation(async (...args) => {
			if (args[0] === "POST")
				throw new ProviderError("network", undefined, true);
			return original(...args);
		});
		await expect(
			runCli(execOptions("apply", "provision,configure"), {
				cwd,
				env: shell,
				api,
				log: vi.fn(),
			}),
		).rejects.toThrow("network");
		expect(
			loadState(join(cwd, ".saas/state.json"), config()).pending?.kind,
		).toBe("d1");
		api.request.mockClear();
		await expect(
			runCli(execOptions("resume", "provision,configure"), {
				cwd,
				env: shell,
				api,
				log: vi.fn(),
			}),
		).rejects.toThrow("uncertain outcome");
		expect(api.request.mock.calls.some((call) => call[0] === "POST")).toBe(
			false,
		);
	});
	it("clears a definitively rejected creation pending marker", async () => {
		const cwd = fixture();
		const api = apiMock();
		const original = api.request.getMockImplementation();
		if (!original) throw new Error("missing mock");
		api.request.mockImplementation(async (...args) => {
			if (args[0] === "POST") throw new ProviderError("denied", 403, false);
			return original(...args);
		});
		await expect(
			runCli(execOptions("apply", "provision,configure"), {
				cwd,
				env: shell,
				api,
				log: vi.fn(),
			}),
		).rejects.toThrow("denied");
		expect(
			loadState(join(cwd, ".saas/state.json"), config()).pending,
		).toBeUndefined();
	});
	it("refuses missing/drifted recorded resources rather than recreating them", async () => {
		const cwd = fixture();
		writeJson(join(cwd, ".saas/state.json"), stateFor());
		const api = apiMock();
		const original = api.request.getMockImplementation();
		if (!original) throw new Error("missing mock");
		api.request.mockImplementation(async (...args) =>
			args[1] === resourcePath("d1", database)
				? {
						success: true,
						result: { uuid: database, name: "other-project-db" },
					}
				: original(...args),
		);
		await expect(
			runCli(execOptions("resume", "provision,configure"), {
				cwd,
				env: shell,
				api,
				log: vi.fn(),
			}),
		).rejects.toThrow("identity");
		expect(api.request.mock.calls.some((call) => call[0] === "POST")).toBe(
			false,
		);
	});
	it("permanent delete requires extra exact confirmation and excludes adopted resources", async () => {
		const cwd = fixture();
		const state = stateFor();
		if (state.resources.kv) state.resources.kv.ownership = "adopted";
		writeJson(join(cwd, ".saas/state.json"), state);
		const api = apiMock();
		const log = vi.fn();
		await runCli(parseArgs(["delete"]), { cwd, env: shell, api, log });
		expect(log.mock.calls[0][0]).not.toContain(`kv:${namespace}`);
		await expect(
			runCli(execOptions("delete", "delete"), { cwd, env: shell, api, log }),
		).rejects.toThrow("Permanent deletion requires");
		expect(api.request).not.toHaveBeenCalled();
	});
});

describe("Cloudflare API and safe copying", () => {
	it("uses fixed Cloudflare host, bearer header, and rejects redirect behavior", async () => {
		const fetcher = vi.fn<typeof fetch>(
			async () => new Response(JSON.stringify({ success: true, result: [] })),
		);
		const api = createCloudflareApi(
			account,
			"not-to-log",
			fetcher as typeof fetch,
		);
		await api.request("GET", "/d1/database");
		expect(fetcher.mock.calls[0][0]).toBe(
			`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`,
		);
		expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
		await expect(api.request("GET", "//evil.test")).rejects.toThrow(
			"Invalid API",
		);
	});
	it("redacts provider error bodies and marks failed mutations uncertain", async () => {
		const fetcher = vi.fn<typeof fetch>(
			async () =>
				new Response(
					JSON.stringify({
						success: false,
						errors: [{ code: 1000, message: "secret-token" }],
					}),
					{ status: 500 },
				),
		);
		const api = createCloudflareApi(account, "token", fetcher as typeof fetch);
		try {
			await api.request("POST", "/d1/database", { name: "app" });
			throw new Error("expected error");
		} catch (error) {
			expect(error).toBeInstanceOf(ProviderError);
			expect((error as ProviderError).uncertain).toBe(true);
			expect((error as Error).message).not.toContain("secret-token");
		}
	});
	it("fetches all R2 cursor pages and matches exact name only", async () => {
		const api = {
			request: vi
				.fn()
				.mockResolvedValueOnce({
					result: { buckets: [{ name: "other-bucket" }] },
					result_info: { cursor: "next" },
				})
				.mockResolvedValueOnce({
					result: { buckets: [{ name: "example-app-files" }] },
					result_info: {},
				}),
		};
		expect(await findByName(api, "r2", "example-app-files")).toEqual([
			{
				id: "example-app-files",
				name: "example-app-files",
				ownership: "adopted",
			},
		]);
		expect(api.request.mock.calls[1][1]).toContain("cursor=next");
	});
	it("validates resource IDs/names and account credentials", async () => {
		const api = apiMock();
		await expect(
			getResource(api, "d1", database, "not-the-name", "adopted"),
		).rejects.toThrow("identity");
		expect(() =>
			assertAccount(config(), {
				...shell,
				CLOUDFLARE_ACCOUNT_ID: "c".repeat(32),
			}),
		).toThrow("differs");
	});
	it("copies only the local original starter, excluding secrets/state/git/symlinks", () => {
		const source = fixture();
		writeFileSync(join(source, "README.md"), "original");
		writeFileSync(join(source, ".env"), "secret");
		writeFileSync(join(source, ".env.example"), "safe");
		mkdirSync(join(source, ".git"));
		writeFileSync(join(source, ".git/config"), "private");
		symlinkSync("/etc/passwd", join(source, "unsafe-link"));
		const parent = mkdtempSync(join(tmpdir(), "saas-copy-"));
		roots.push(parent);
		const destination = join(parent, "project");
		copyTemplate(source, destination);
		expect(existsSync(join(destination, "README.md"))).toBe(true);
		expect(existsSync(join(destination, ".env.example"))).toBe(true);
		expect(existsSync(join(destination, ".env"))).toBe(false);
		expect(existsSync(join(destination, ".saas"))).toBe(false);
		expect(existsSync(join(destination, ".git"))).toBe(false);
		expect(existsSync(join(destination, "unsafe-link"))).toBe(false);
	});
	it("refuses copying onto an existing destination or into the source", () => {
		const source = fixture();
		expect(() => copyTemplate(source, source)).toThrow();
		expect(() => copyTemplate(source, join(source, "nested"))).toThrow();
		const destination = fixture();
		expect(() => copyTemplate(source, destination)).toThrow("already exists");
	});
});

describe("destructive commands are user-operated and fully mocked", () => {
	const deletion = (...extra: string[]) =>
		parseArgs([
			"delete",
			"--execute",
			"--confirm",
			"example-app",
			"--allow",
			"delete",
			"--confirm-delete",
			"DELETE example-app",
			"--delete-resources",
			"d1,r2,kv",
			...extra,
		]);
	it("deletes only exact recorded owned resource IDs and persists tombstones", async () => {
		const cwd = fixture();
		writeJson(join(cwd, ".saas/state.json"), stateFor());
		const api = apiMock();
		await runCli(deletion(), { cwd, env: shell, api, log: vi.fn() });
		expect(
			api.request.mock.calls
				.filter((call) => call[0] === "DELETE")
				.map((call) => call[1]),
		).toEqual([
			resourcePath("d1", database),
			resourcePath("r2", "example-app-files"),
			resourcePath("kv", namespace),
		]);
		const state = loadState(join(cwd, ".saas/state.json"), config());
		expect(state.resources).toEqual({});
		expect(Object.keys(state.deleted || {})).toHaveLength(3);
		api.request.mockClear();
		await runCli(deletion(), { cwd, env: shell, api, log: vi.fn() });
		expect(api.request).not.toHaveBeenCalled();
		await expect(
			runCli(execOptions("resume", "provision,configure"), {
				cwd,
				env: shell,
				api,
				log: vi.fn(),
			}),
		).rejects.toThrow("tombstones");
	});
	it("refuses to delete any selected adopted resource before touching remote state", async () => {
		const cwd = fixture();
		const state = stateFor();
		if (state.resources.kv) state.resources.kv.ownership = "adopted";
		writeJson(join(cwd, ".saas/state.json"), state);
		const api = apiMock();
		await expect(
			runCli(deletion(), { cwd, env: shell, api, log: vi.fn() }),
		).rejects.toThrow("adopted");
		expect(api.request).not.toHaveBeenCalled();
	});
	it("verifies all selected resource names before the first delete request", async () => {
		const cwd = fixture();
		writeJson(join(cwd, ".saas/state.json"), stateFor());
		const api = apiMock();
		const original = api.request.getMockImplementation();
		if (!original) throw new Error("mock");
		api.request.mockImplementation(async (...args) =>
			args[1] === resourcePath("kv", namespace)
				? { success: true, result: { id: namespace, title: "unrelated-cache" } }
				: original(...args),
		);
		await expect(
			runCli(deletion(), { cwd, env: shell, api, log: vi.fn() }),
		).rejects.toThrow("identity");
		expect(api.request.mock.calls.some((call) => call[0] === "DELETE")).toBe(
			false,
		);
	});
	it("retains uncertain deletion, then reconciles exact-ID 404 before further deletes", async () => {
		const cwd = fixture();
		writeJson(join(cwd, ".saas/state.json"), stateFor());
		const api = apiMock();
		const original = api.request.getMockImplementation();
		if (!original) throw new Error("mock");
		api.request.mockImplementation(async (...args) => {
			if (args[0] === "DELETE")
				throw new ProviderError("lost response", undefined, true);
			return original(...args);
		});
		await expect(
			runCli(deletion(), { cwd, env: shell, api, log: vi.fn() }),
		).rejects.toThrow("lost response");
		expect(
			loadState(join(cwd, ".saas/state.json"), config()).pending?.kind,
		).toBe("d1");
		api.request.mockClear();
		api.request.mockImplementation(async (...args) => {
			if (args[1] === resourcePath("d1", database))
				throw new ProviderError("gone", 404, false);
			return original(...args);
		});
		await runCli(deletion(), { cwd, env: shell, api, log: vi.fn() });
		expect(
			api.request.mock.calls.filter((call) => call[0] === "DELETE"),
		).toHaveLength(2);
		expect(
			loadState(join(cwd, ".saas/state.json"), config()).deleted?.d1?.id,
		).toBe(database);
	});
	it("never offers an automatic recursive bucket purge", async () => {
		const cwd = fixture();
		writeJson(join(cwd, ".saas/state.json"), stateFor());
		const api = apiMock();
		const original = api.request.getMockImplementation();
		if (!original) throw new Error("mock");
		api.request.mockImplementation(async (...args) => {
			if (args[0] === "DELETE" && args[1].startsWith("/r2/"))
				throw new ProviderError("bucket nonempty", 409, false);
			return original(...args);
		});
		const options = parseArgs([
			"delete",
			"--execute",
			"--confirm",
			"example-app",
			"--allow",
			"delete",
			"--confirm-delete",
			"DELETE example-app",
			"--delete-resources",
			"r2",
		]);
		await expect(
			runCli(options, { cwd, env: shell, api, log: vi.fn() }),
		).rejects.toThrow("bucket nonempty");
		expect(
			api.request.mock.calls.some((call) => call[1].includes("/objects")),
		).toBe(false);
	});
});

describe("explicit database Studio and schema review helpers", () => {
	function localFixture(): string {
		const cwd = fixture();
		mkdirSync(join(cwd, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"), {
			recursive: true,
		});
		writeFileSync(
			join(
				cwd,
				".wrangler/state/v3/d1/miniflare-D1DatabaseObject/metadata.sqlite",
			),
			"metadata",
		);
		writeFileSync(
			join(cwd, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite"),
			"sqlite",
		);
		writeFileSync(
			join(cwd, "wrangler.jsonc"),
			JSON.stringify({
				d1_databases: [{ binding: "DB", database_id: database }],
				account_id: account,
			}),
		);
		return cwd;
	}
	it("selects a sole configured local DB, not metadata, and never remote credentials", () => {
		const cwd = localFixture();
		expect(findLocalDatabase(cwd)).toContain("/db.sqlite");
		const plan = studioPlan(cwd, { remote: false, execute: false }, shell);
		expect(plan.command.args).toContain("127.0.0.1");
		expect(plan.command.env?.DB_LOCAL_URL).toContain("file:");
		expect(plan.command.env?.CLOUDFLARE_API_TOKEN).toBeUndefined();
		expect(plan.configSource).toContain("process.env.DB_LOCAL_URL");
	});
	it("requires explicit file selection when multiple local databases exist", () => {
		const cwd = localFixture();
		writeFileSync(
			join(
				cwd,
				".wrangler/state/v3/d1/miniflare-D1DatabaseObject/other.sqlite",
			),
			"sqlite",
		);
		expect(() => findLocalDatabase(cwd)).toThrow("Found 2");
		expect(
			findLocalDatabase(
				cwd,
				".wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite",
			),
		).toContain("/db.sqlite");
	});
	it("rejects local symlinks, metadata selection, and files outside D1 state", () => {
		const cwd = localFixture();
		expect(() =>
			findLocalDatabase(
				cwd,
				".wrangler/state/v3/d1/miniflare-D1DatabaseObject/metadata.sqlite",
			),
		).toThrow("--file");
		expect(() => findLocalDatabase(cwd, "/etc/passwd")).toThrow("--file");
		symlinkSync(
			"/etc/passwd",
			join(cwd, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/link.sqlite"),
		);
		expect(() =>
			findLocalDatabase(
				cwd,
				".wrangler/state/v3/d1/miniflare-D1DatabaseObject/link.sqlite",
			),
		).toThrow("--file");
	});
	it("remote Studio requires explicit matching account/database and puts token only in env", () => {
		const cwd = localFixture();
		expect(() =>
			studioPlan(cwd, { remote: true, execute: false }, shell),
		).toThrow("CLOUDFLARE_DATABASE_ID");
		const plan = studioPlan(
			cwd,
			{ remote: true, execute: false },
			{ ...shell, CLOUDFLARE_DATABASE_ID: database },
		);
		expect(plan.configSource).toContain("driver: 'd1-http'");
		expect(plan.configSource).not.toContain(shell.CLOUDFLARE_API_TOKEN);
		expect(commandText(plan.command)).not.toContain(shell.CLOUDFLARE_API_TOKEN);
		expect(() =>
			studioPlan(
				cwd,
				{ remote: true, execute: false },
				{
					...shell,
					CLOUDFLARE_DATABASE_ID: "99999999-2222-3333-4444-555555555555",
				},
			),
		).toThrow("must match");
	});
	it("Studio dry-run launches no server and writes no config", async () => {
		const cwd = localFixture();
		const run = vi.fn();
		await runStudio(
			{ remote: false, execute: false },
			{ cwd, env: shell, run, log: vi.fn() },
		);
		expect(run).not.toHaveBeenCalled();
		expect(existsSync(join(cwd, ".saas/drizzle-studio-local.config.ts"))).toBe(
			false,
		);
	});
	it("local Studio requires explicit confirmation and a SQLite driver", async () => {
		const cwd = localFixture();
		await expect(
			runStudio(
				{ remote: false, execute: true },
				{ cwd, env: shell, run: vi.fn(), log: vi.fn() },
			),
		).rejects.toThrow("--confirm local");
		await expect(
			runStudio(
				{ remote: false, execute: true, confirm: "local" },
				{ cwd, env: shell, run: vi.fn(), log: vi.fn() },
			),
		).rejects.toThrow("requires @libsql");
	});
	it("Studio config uses env references and is removed after mocked process exit", async () => {
		const cwd = localFixture();
		mkdirSync(join(cwd, "node_modules/@libsql/client"), { recursive: true });
		const run = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
		await runStudio(
			{ remote: false, execute: true, confirm: "local" },
			{ cwd, env: shell, run, log: vi.fn() },
		);
		expect(run).toHaveBeenCalledOnce();
		expect(existsSync(join(cwd, ".saas/drizzle-studio-local.config.ts"))).toBe(
			false,
		);
	});
	it("schema helper generates only a review artifact and never invokes migrate/init/secret", () => {
		const command = authSchemaCommand();
		expect(command.args).toContain("--no-install");
		expect(command.args).toContain("generate");
		expect(command.args).toContain(".saas/auth-schema.generated.ts");
		expect(command.args).not.toContain("migrate");
		expect(command.args).not.toContain("secret");
	});
	it("schema dry-run reads the installed version but runs/downloads nothing", async () => {
		const cwd = fixture();
		mkdirSync(join(cwd, "node_modules/better-auth"), { recursive: true });
		writeFileSync(
			join(cwd, "node_modules/better-auth/package.json"),
			'{"version":"1.7.12"}',
		);
		const run = vi.fn();
		await runAuthSchema(false, { cwd, run, log: vi.fn() });
		expect(run).not.toHaveBeenCalled();
		await expect(
			runAuthSchema(true, { cwd, run, log: vi.fn() }),
		).rejects.toThrow("not installed");
	});
	it("schema execution refuses mismatched pinned CLI version and existing output", async () => {
		const cwd = fixture();
		for (const name of ["better-auth", "auth", ".bin"])
			mkdirSync(join(cwd, "node_modules", name), { recursive: true });
		writeFileSync(join(cwd, "node_modules/.bin/auth"), "");
		writeFileSync(
			join(cwd, "node_modules/better-auth/package.json"),
			'{"version":"1.7.12"}',
		);
		writeFileSync(
			join(cwd, "node_modules/auth/package.json"),
			'{"version":"1.6.0"}',
		);
		await expect(
			runAuthSchema(true, { cwd, run: vi.fn(), log: vi.fn() }),
		).rejects.toThrow("versions differ");
		writeFileSync(
			join(cwd, "node_modules/auth/package.json"),
			'{"version":"1.7.12"}',
		);
		writeFileSync(
			join(cwd, ".saas/auth-schema.generated.ts"),
			"reviewed existing",
		);
		await expect(
			runAuthSchema(true, { cwd, run: vi.fn(), log: vi.fn() }),
		).rejects.toThrow("existing generated");
		expect(
			readFileSync(join(cwd, ".saas/auth-schema.generated.ts"), "utf8"),
		).toBe("reviewed existing");
	});
});

describe("schema push safeguards (mocked execution only)", () => {
	function pushFixture(): string {
		const cwd = fixture();
		mkdirSync(join(cwd, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"), {
			recursive: true,
		});
		writeFileSync(
			join(cwd, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite"),
			"fixture-not-a-real-database",
		);
		writeFileSync(
			join(cwd, "wrangler.jsonc"),
			JSON.stringify({
				d1_databases: [{ binding: "DB", database_id: database }],
				account_id: account,
			}),
		);
		mkdirSync(join(cwd, "node_modules/@libsql/client"), { recursive: true });
		return cwd;
	}
	it("defaults to a no-process/no-write plan and distinguishes push from migrations", async () => {
		const cwd = pushFixture();
		const run = vi.fn();
		const log = vi.fn();
		await runDatabasePush(
			{ remote: false, execute: false, ackDataLoss: false },
			{ cwd, env: shell, run, log },
		);
		expect(run).not.toHaveBeenCalled();
		expect(existsSync(join(cwd, ".saas/drizzle-push-local.config.ts"))).toBe(
			false,
		);
		expect(existsSync(join(cwd, ".saas/db-push-pending.json"))).toBe(false);
		expect(log.mock.calls.flat().join(" ")).toContain("not a live schema diff");
	});
	it("requires exact local file confirmation and independent data-loss acknowledgment", async () => {
		const cwd = pushFixture();
		const target = findLocalDatabase(cwd);
		const run = vi.fn();
		await expect(
			runDatabasePush(
				{ remote: false, execute: true, confirm: "local", ackDataLoss: true },
				{ cwd, env: shell, run, log: vi.fn() },
			),
		).rejects.toThrow("exact displayed");
		await expect(
			runDatabasePush(
				{ remote: false, execute: true, confirm: target, ackDataLoss: false },
				{ cwd, env: shell, run, log: vi.fn() },
			),
		).rejects.toThrow("--ack-data-loss");
		expect(run).not.toHaveBeenCalled();
	});
	it("uses the exact local URL with no inherited deployment token and removes temporary files after mock success", async () => {
		const cwd = pushFixture();
		const target = findLocalDatabase(cwd);
		const run = vi.fn(async (command: ProcessCommand) => {
			expect(command.args).toContain("push");
			expect(command.args).toContain("--force");
			expect(command.args).not.toContain("migrate");
			expect(command.env?.DB_LOCAL_URL).toContain("db.sqlite");
			expect(command.env?.CLOUDFLARE_API_TOKEN).toBeUndefined();
			expect(
				readFileSync(join(cwd, ".saas/drizzle-push-local.config.ts"), "utf8"),
			).toContain("process.env.DB_LOCAL_URL");
			return { code: 0, stdout: "", stderr: "" };
		});
		await runDatabasePush(
			{ remote: false, execute: true, confirm: target, ackDataLoss: true },
			{ cwd, env: shell, run, log: vi.fn() },
		);
		expect(run).toHaveBeenCalledOnce();
		expect(existsSync(join(cwd, ".saas/drizzle-push-local.config.ts"))).toBe(
			false,
		);
		expect(existsSync(join(cwd, ".saas/db-push-pending.json"))).toBe(false);
		expect(readFileSync(target, "utf8")).toBe("fixture-not-a-real-database");
	});
	it("validates exact remote binding/account and puts credentials only in the child environment", () => {
		const cwd = pushFixture();
		const plan = databasePushPlan(
			cwd,
			{ remote: true, execute: false, ackDataLoss: false },
			{ ...shell, CLOUDFLARE_DATABASE_ID: database },
		);
		expect(plan.target).toBe(database);
		expect(plan.configSource).toContain("driver: 'd1-http'");
		expect(plan.command.env?.CLOUDFLARE_API_TOKEN).toBe(
			shell.CLOUDFLARE_API_TOKEN,
		);
		expect(commandText(plan.command)).not.toContain(shell.CLOUDFLARE_API_TOKEN);
		expect(plan.configSource).not.toContain(shell.CLOUDFLARE_API_TOKEN);
		expect(() =>
			databasePushPlan(
				cwd,
				{ remote: true, execute: false, ackDataLoss: false },
				{
					...shell,
					CLOUDFLARE_ACCOUNT_ID: "c".repeat(32),
					CLOUDFLARE_DATABASE_ID: database,
				},
			),
		).toThrow("must match");
	});
	it("refuses ambiguous local targets rather than choosing an arbitrary file", () => {
		const cwd = pushFixture();
		writeFileSync(
			join(
				cwd,
				".wrangler/state/v3/d1/miniflare-D1DatabaseObject/other.sqlite",
			),
			"other",
		);
		expect(() =>
			databasePushPlan(
				cwd,
				{ remote: false, execute: false, ackDataLoss: false },
				shell,
			),
		).toThrow("Found 2");
	});
	it("persists uncertainty without values and prevents a blind retry after failure", async () => {
		const cwd = pushFixture();
		const target = findLocalDatabase(cwd);
		const run = vi.fn(async () => ({
			code: 1,
			stdout: "secret-output",
			stderr: "secret-output",
		}));
		const log = vi.fn();
		const options = {
			remote: false,
			execute: true,
			confirm: target,
			ackDataLoss: true,
		};
		await expect(
			runDatabasePush(options, { cwd, env: shell, run, log }),
		).rejects.toThrow("partially changed");
		expect(existsSync(join(cwd, ".saas/drizzle-push-local.config.ts"))).toBe(
			false,
		);
		const journal = readFileSync(
			join(cwd, ".saas/db-push-pending.json"),
			"utf8",
		);
		expect(journal).not.toContain(shell.CLOUDFLARE_API_TOKEN);
		expect(JSON.parse(journal).target).toBe(target);
		expect(log.mock.calls.flat().join(" ")).not.toContain("secret-output");
		run.mockClear();
		await expect(
			runDatabasePush(options, { cwd, env: shell, run, log }),
		).rejects.toThrow("unresolved outcome");
		expect(run).not.toHaveBeenCalled();
	});
});

describe("explicit public-variable synchronization semantics", () => {
	it("distinguishes omitted and blank public values, never clears secrets", () => {
		expect(
			splitEnvironment({ VITE_CRISP_WEBSITE_ID: "", STRIPE_SECRET_KEY: "" }),
		).toEqual({
			public: { VITE_CRISP_WEBSITE_ID: "" },
			runtime: {},
			deployment: {},
		});
		expect(() =>
			secretCommands(
				"github-secrets",
				config(),
				parseArgs(["sync-github-secrets", "--public-vars"]),
				{ VITE_CRISP_WEBSITE_ID: "" },
			),
		).toThrow("--clear-public");
		expect(() =>
			secretCommands(
				"github-secrets",
				config(),
				parseArgs([
					"sync-github-secrets",
					"--public-vars",
					"--clear-public",
					"STRIPE_SECRET_KEY",
				]),
				{},
			),
		).toThrow("Only allowlisted public");
	});
	it("requires a public destination and forbids contradictory nonempty clears", () => {
		expect(() =>
			secretCommands(
				"github-secrets",
				config(),
				parseArgs([
					"sync-github-secrets",
					"--credentials",
					"--clear-public",
					"VITE_PAYMENT_PROVIDER",
				]),
				{},
			),
		).toThrow("requires --public-vars");
		expect(() =>
			secretCommands(
				"github-secrets",
				config(),
				parseArgs([
					"sync-github-secrets",
					"--public-vars",
					"--clear-public",
					"VITE_PAYMENT_PROVIDER",
				]),
				{ VITE_PAYMENT_PROVIDER: "stripe" },
			),
		).toThrow("non-empty");
	});
	it("plans exact public deletions and read-back, even when key omitted locally", () => {
		const commands = secretCommands(
			"github-secrets",
			{ ...config(), githubEnvironment: "production" },
			parseArgs([
				"sync-github-secrets",
				"--public-vars",
				"--clear-public",
				"VITE_CRISP_WEBSITE_ID",
			]),
			{},
		);
		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({
			executable: "gh",
			args: [
				"variable",
				"delete",
				"VITE_CRISP_WEBSITE_ID",
				"--repo",
				"example/example-app",
				"--env",
				"production",
			],
			verifyPublic: {
				key: "VITE_CRISP_WEBSITE_ID",
				value: null,
				args: [
					"variable",
					"list",
					"--json",
					"name,value",
					"--repo",
					"example/example-app",
					"--env",
					"production",
				],
			},
		});
	});
	it.each([true, false])(
		"verifies remote public deletion with mock transport, already absent=%s",
		async (absent) => {
			const cwd = fixture();
			writeFileSync(join(cwd, "public.env"), 'VITE_CRISP_WEBSITE_ID=""\n');
			const options = execOptions("sync-github-secrets", "github-secrets");
			options.publicVars = true;
			options.clearPublic = ["VITE_CRISP_WEBSITE_ID"];
			options.envFile = "public.env";
			let exists = !absent;
			const run = vi.fn(async (command: ProcessCommand) => {
				if (command.args[0] === "auth")
					return { code: 0, stderr: "", stdout: "" };
				if (command.args[1] === "list")
					return {
						code: 0,
						stderr: "",
						stdout: JSON.stringify(
							exists
								? [{ name: "VITE_CRISP_WEBSITE_ID", value: "old-public-id" }]
								: [],
						),
					};
				expect(command.args.slice(0, 3)).toEqual([
					"variable",
					"delete",
					"VITE_CRISP_WEBSITE_ID",
				]);
				exists = false;
				return { code: 0, stderr: "", stdout: "" };
			});
			await runCli(options, { cwd, env: {}, run, log: vi.fn() });
			expect(run).toHaveBeenCalledTimes(absent ? 2 : 4);
			expect(
				loadState(join(cwd, ".saas/state.json"), config()).completed,
			).toContain("github-secrets");
		},
	);
	it("does not mark success when a public set read-back remains stale", async () => {
		const cwd = fixture();
		writeFileSync(join(cwd, "public.env"), 'VITE_PAYMENT_PROVIDER="none"\n');
		const options = execOptions("sync-github-secrets", "github-secrets");
		options.publicVars = true;
		options.envFile = "public.env";
		const run = vi.fn(async (command: ProcessCommand) => ({
			code: 0,
			stderr: "",
			stdout:
				command.args[1] === "list"
					? JSON.stringify([{ name: "VITE_PAYMENT_PROVIDER", value: "stripe" }])
					: "",
		}));
		await expect(
			runCli(options, { cwd, env: {}, run, log: vi.fn() }),
		).rejects.toThrow("read-back did not match");
		expect(
			loadState(join(cwd, ".saas/state.json"), config()).pending?.stage,
		).toBe("github-secrets");
	});
});
