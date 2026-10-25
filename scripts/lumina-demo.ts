import { fixtureOrigin } from "../tests/e2e/environment";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { localSmokeEnvironment, prepareLocalSmoke } from "./local/isolation";
import { installLuminaFixtures } from "./local/lumina-fixtures";

const source = process.cwd();
const target = prepareLocalSmoke(source);
installLuminaFixtures(target);
const env = localSmokeEnvironment(target);
env.E2E_PERSIST_PATH = mkdtempSync("/tmp/edgekit-e2e-lumina-");
const run = (args: string[]) => {
	const result = spawnSync(process.execPath, args, {
		cwd: target,
		env,
		stdio: "inherit",
		shell: false,
	});
	if (result.status !== 0) throw Error("Local Lumina fixture command failed.");
};
run([join(target, "node_modules/vite/bin/vite.js"), "build"]);
run([
	"--import",
	"tsx",
	"--eval",
	"import('./tests/e2e/setup.ts').then(m => m.default())",
]);
console.log(
	`LOCAL FIXTURE ONLY: ${fixtureOrigin} | e2e.member@example.invalid | E2eFixturePassword!23`,
);
console.log(
	"No real AI, payments or mail. Stop with Ctrl-C. Never deploy the generated checkout.",
);
run(["--import", "tsx", join(target, "tests/e2e/start-worker.ts")]);
