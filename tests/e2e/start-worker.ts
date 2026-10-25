import { spawn } from "node:child_process";
import {
	assertIsolatedTestCheckout,
	testEnvironment,
	testState,
 fixturePort,
 fixtureOrigin,
} from "./environment";
assertIsolatedTestCheckout();
const child = spawn(
	"npx",
	[
		"wrangler",
		"dev",
		"--config",
		"dist/server/wrangler.json",
		"--port",
		fixturePort(),
		"--ip",
		"127.0.0.1",
		"--inspector-port",
		"0",
		"--persist-to",
		testState(),
		"--var",
		"APP_ENV:test",
		"--var",
		`APP_URL:${fixtureOrigin}`,
		"--var",
		"BETTER_AUTH_SECRET:e2e-only-fixed-fixture-not-a-production-secret-12345",
	],
	{ stdio: "inherit", env: testEnvironment(), shell: false },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
