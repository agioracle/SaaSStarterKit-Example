import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assertIsolatedTestCheckout } from "../tests/e2e/environment";
assertIsolatedTestCheckout();
// Public, deliberately nonfunctional test identifiers, never copied into runtime secrets.
const env: NodeJS.ProcessEnv = {
	PATH: process.env.PATH,
	HOME: process.env.HOME,
	XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
	CI: process.env.CI,
	PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
	PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:
		process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
	CLOUDFLARE_SEND_METRICS: "false",
	WRANGLER_LOG_PATH: "/tmp/edgekit-privacy-wrangler.log",
	VITE_GOOGLE_ANALYTICS_ID: "G-PRIVACYTEST",
	VITE_CRISP_WEBSITE_ID: "privacy-test-only",
	VITE_APP_URL: "http://127.0.0.1:4173",
};
console.log(
	"Building isolated privacy fixture. Every external browser request is intercepted. This build is test-only; rebuild with your production configuration before deployment.",
);
for (const args of [
	[resolve("node_modules/vite/bin/vite.js"), "build"],
	[
		resolve("node_modules/@playwright/test/cli.js"),
		"test",
		"--config",
		"playwright.privacy.config.ts",
	],
]) {
	const result = spawnSync(process.execPath, args, {
		env,
		stdio: "inherit",
		shell: false,
	});
	if (result.status !== 0) {
		process.exitCode = result.status || 1;
		break;
	}
}
