import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
const directories = [
	"src",
	"tests",
	"scripts",
	"public",
	"content",
	"messages",
	"project.inlang",
	"drizzle",
	"examples",
];
const excluded = new Set([
	"node_modules",
	"dist",
	".git",
	".wrangler",
	".tanstack",
	".content-collections",
	".saas",
	".local-smoke",
	"test-results",
	"playwright-report",
	"paraglide",
]);
export function smokeCopyFilter(path: string) {
	const name = basename(path);
	return (
		!excluded.has(name) &&
		!(/^\.(env|dev\.vars)(\.|$)/.test(name) && !name.endsWith(".example")) &&
		!name.endsWith(".backup") &&
		!lstatSync(path).isSymbolicLink()
	);
}
/** Never overwrite the operator's env files, seed their DB, or inherit provider credentials. */
export function prepareLocalSmoke(root: string) {
	const source = resolve(root);
	const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
	if (
		pkg.edgekit?.template !== "cloudflare-saas-starter" ||
		pkg.edgekit?.schemaVersion !== 1
	)
		throw Error("Run this helper from the starter root.");
	if (!existsSync(join(source, "node_modules", "vite")))
		throw Error(
			"Run npm ci first. No dependency installation is performed by this helper.",
		);
	const parent = join(source, ".local-smoke");
	mkdirSync(parent, { recursive: true });
	const target = mkdtempSync(join(parent, "run-"));
	for (const name of readdirSync(source)) {
		const path = join(source, name);
		const stat = lstatSync(path);
		if (!smokeCopyFilter(path)) continue;
		if (stat.isDirectory()) {
			if (directories.includes(name))
				cpSync(path, join(target, name), {
					recursive: true,
					filter: smokeCopyFilter,
				});
		} else if (
			/\.(ts|json|jsonc)$/.test(name) ||
			["package-lock.json", ".env.example", ".dev.vars.example"].includes(name)
		)
			cpSync(path, join(target, name));
	}
	const dependencies = join(target, "node_modules");
	mkdirSync(dependencies);
	for (const name of readdirSync(join(source, "node_modules"))) {
		if (name.startsWith(".") && name !== ".bin") continue;
		symlinkSync(
			join(source, "node_modules", name),
			join(dependencies, name),
			"junction",
		);
	}
	mkdirSync(join(target, ".home"));
	writeFileSync(
		join(target, "LOCAL-SMOKE.txt"),
		"Isolated local fixtures only. Environment files and real provider credentials were not copied. Do not deploy this build. The HTTP tests seed deliberately public fixture accounts in a separate local D1. No live-provider success is asserted.\n",
	);
	return target;
}
export function localSmokeEnvironment(
	target: string,
	source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	return {
		PATH: source.PATH || "",
		HOME: join(target, ".home"),
		XDG_CONFIG_HOME: join(target, ".home"),
		CI: "true",
		CLOUDFLARE_SEND_METRICS: "false",
		WRANGLER_LOG_PATH: join(target, "wrangler.log"),
		VITE_BASE_URL: "http://127.0.0.1:4173",
	};
}
