import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { childEnvironment } from "./cli/secrets.ts";
import {
	commandText,
	runProcess,
	type ProcessCommand,
	type ProcessRunner,
} from "./cli/runner.ts";

export function authSchemaCommand(): ProcessCommand {
	return {
		executable: "npx",
		args: [
			"--no-install",
			"auth",
			"generate",
			"--adapter",
			"drizzle",
			"--dialect",
			"sqlite",
			"--config",
			"scripts/auth.schema.config.ts",
			"--output",
			".saas/auth-schema.generated.ts",
			"--yes",
		],
	};
}
export async function runAuthSchema(
	execute: boolean,
	dependencies: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		run?: ProcessRunner;
		log?: (message: string) => void;
	} = {},
): Promise<void> {
	const cwd = dependencies.cwd || process.cwd();
	const log = dependencies.log || console.log;
	const installed = JSON.parse(
		readFileSync(resolve(cwd, "node_modules/better-auth/package.json"), "utf8"),
	) as { version: string };
	const command = authSchemaCommand();
	log(
		`Installed Better Auth: ${installed.version}. Offline schema plugins: admin, bearer, apiKey; database rate limiting enabled.`,
	);
	log(commandText(command));
	log(
		"Output is review-only .saas/auth-schema.generated.ts. It never overwrites src/db/schema.ts, generates credentials, or applies migrations.",
	);
	if (!execute) {
		log(
			"Dry run. Validate the pinned auth CLI compatibility before executing.",
		);
		return;
	}
	if (!existsSync(resolve(cwd, "node_modules/.bin/auth")))
		throw new Error(
			"The auth CLI is not installed locally. Install a compatible pinned auth dev dependency; this command will not download latest automatically.",
		);
	const cli = JSON.parse(
		readFileSync(resolve(cwd, "node_modules/auth/package.json"), "utf8"),
	) as { version: string };
	if (cli.version !== installed.version)
		throw new Error(
			"Pinned auth CLI and better-auth package versions differ. Review compatibility and align them before generating.",
		);
	if (existsSync(resolve(cwd, ".saas/auth-schema.generated.ts")))
		throw new Error(
			"Review/move the existing generated schema before generating again. Application schema is never overwritten.",
		);
	mkdirSync(resolve(cwd, ".saas"), { recursive: true, mode: 0o700 });
	const result = await (dependencies.run || runProcess)(
		{ ...command, env: childEnvironment(dependencies.env || process.env) },
		cwd,
	);
	if (result.code)
		throw new Error(
			`Auth schema generation failed with code ${result.code}; raw output suppressed.`,
		);
	if (!existsSync(resolve(cwd, ".saas/auth-schema.generated.ts")))
		throw new Error(
			"Auth CLI returned success without the expected review artifact.",
		);
	log(
		"Generated a separate review artifact. Compare it with src/db/schema.ts, merge only deliberate auth changes, then generate/review a Drizzle migration separately.",
	);
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const { values } = parseArgs({
		options: { execute: { type: "boolean" }, help: { type: "boolean" } },
		strict: true,
	});
	if (values.help)
		console.log(
			"Usage: npm run auth:schema:generate -- [--execute]\nDefault prints and validates the offline generation contract; --execute writes only a new .saas/auth-schema.generated.ts review artifact.",
		);
	else
		runAuthSchema(values.execute || false).catch((error) => {
			console.error(
				error instanceof Error
					? error.message
					: "Auth schema generation failed",
			);
			process.exitCode = 1;
		});
}
