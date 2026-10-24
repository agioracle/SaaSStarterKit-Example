import { seedBrowserContent } from './local/content-fixtures';
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { localSmokeEnvironment, prepareLocalSmoke } from "./local/isolation";
const options = process.argv.slice(2);
if (options.some((value) => value !== "--prepare-only"))
	throw Error("Usage: npm run smoke:local -- [--prepare-only]");
const target = prepareLocalSmoke(process.cwd());
seedBrowserContent(process.cwd(), target);
console.log(`Created credential-free local fixture checkout: ${target}`);
console.log(
	"This is local HTTP/SSR plus captured-mail verification, not browser QA, OAuth or live provider validation. Existing env files and databases are untouched.",
);
if (!options.includes("--prepare-only")) {
	const env = localSmokeEnvironment(target);
	const commands = [
		[resolve(target, "node_modules/vite/bin/vite.js"), "build"],
		[
			resolve(target, "node_modules/vitest/vitest.mjs"),
			"run",
			"tests/auth.integration.test.ts",
			"--testNamePattern",
			"requires email verification|keeps password-reset responses",
		],
		[
			resolve(target, "node_modules/@playwright/test/cli.js"),
			"test",
			"--grep",
			"@http",
		],
	];
	for (const args of commands) {
		const result = spawnSync(process.execPath, args, {
			cwd: target,
			env,
			stdio: "inherit",
			shell: false,
		});
		if (result.error) throw result.error;
		if (result.status !== 0) {
			process.exitCode = result.status || 1;
			break;
		}
	}
	if (!process.exitCode)
		console.log(
			"Local smoke passed. The isolated checkout remains available for inspecting test evidence; it is not a deployable production build.",
		);
}
