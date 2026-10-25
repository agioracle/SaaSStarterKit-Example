// Only the loopback port is configurable; fixture hosts and data stay isolated.
export function fixturePort() {
 const value = process.env.E2E_PORT || "4173";
 if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw Error("E2E_PORT must be a local unprivileged port.");
 return value;
}
export const fixtureOrigin = `http://127.0.0.1:${fixturePort()}`;
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
export function assertIsolatedTestCheckout() {
	for (const directory of [".", "dist/server"]) {
		if (!existsSync(directory)) continue;
		for (const name of readdirSync(directory)) {
			if (
				/^\.(?:env|dev\.vars)(?:\.|$)/.test(name) &&
				!name.endsWith(".example")
			)
				throw Error(
					`E2E refuses runtime env files in ${directory}. Use a dedicated test checkout without credentials.`,
				);
		}
	}
}
export function testState() {
	const state = process.env.E2E_PERSIST_PATH;
	if (!state || !/^\/tmp\/edgekit-e2e-[A-Za-z0-9_-]+$/.test(state))
		throw Error("An isolated /tmp/edgekit-e2e-* state directory is required.");
	return state;
}
export function testEnvironment() {
	const home = resolve(testState(), "home");
	mkdirSync(home, { recursive: true });
	return {
		PATH: process.env.PATH || "",
		HOME: home,
		XDG_CONFIG_HOME: home,
		CI: "true",
		CLOUDFLARE_SEND_METRICS: "false",
		WRANGLER_LOG_PATH: resolve(testState(), "wrangler.log"),
		E2E_PERSIST_PATH: testState(),
	};
}
