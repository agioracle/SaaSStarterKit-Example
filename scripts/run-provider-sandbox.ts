import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readSandboxConfig, SandboxError } from "../tests/sandbox/config";
export function sandboxLaunchPlan(
	provider: string,
	env: NodeJS.ProcessEnv = process.env,
) {
	if (!["stripe", "creem", "waffo"].includes(provider))
		throw new SandboxError("SANDBOX_INVALID_PROVIDER");
	if (env.SANDBOX_PROVIDER && env.SANDBOX_PROVIDER !== provider)
		throw new SandboxError("SANDBOX_PROVIDER_ALIAS_CONFLICT");
	const selected = { ...env, SANDBOX_PROVIDER: provider };
	readSandboxConfig(selected); // Existing staging/authorization/budget/account gates remain mandatory.
	return {
		args: [
			resolve("node_modules/@playwright/test/cli.js"),
			"test",
			"--config",
			"playwright.sandbox.config.ts",
		],
		env: selected,
	};
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		if (process.argv.includes("--help"))
			console.log(
				"Explicit manual-assisted provider sandbox acceptance only. Read docs/provider-acceptance.md. The alias selects the provider but does not bypass any staging, credentials, budget, or scenario acknowledgements. No deployment or tunnel is started.",
			);
		else {
			const plan = sandboxLaunchPlan(process.argv[2] || "");
			const result = spawnSync(process.execPath, plan.args, {
				env: plan.env,
				stdio: "inherit",
				shell: false,
			});
			if (result.error) throw result.error;
			process.exitCode = result.status ?? 1;
		}
	} catch (error) {
		console.error(
			error instanceof SandboxError ? error.code : "SANDBOX_LAUNCH_FAILED",
		);
		process.exitCode = 1;
	}
}
