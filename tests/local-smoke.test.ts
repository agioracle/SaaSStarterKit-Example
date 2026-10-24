import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	existsSync,
	readFileSync,
	symlinkSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import {
	prepareLocalSmoke,
	localSmokeEnvironment,
} from "../scripts/local/isolation";
describe("safe first-run local smoke isolation", () => {
	it("preserves original env files, excludes secrets/generated state/symlinks, and sanitizes child environment", () => {
		const root = mkdtempSync(join(tmpdir(), "smoke-source-"));
		try {
			writeFileSync(
				join(root, "package.json"),
				JSON.stringify({
					name: "my-renamed-product",
					edgekit: { template: "cloudflare-saas-starter", schemaVersion: 1 },
				}),
			);
			for (const path of [
				"node_modules/vite",
				"src",
				".wrangler",
				"src/paraglide",
			])
				mkdirSync(join(root, path), { recursive: true });
			writeFileSync(join(root, ".dev.vars"), "NOT_A_REAL_SECRET=fixture-value");
			writeFileSync(
				join(root, ".env.production"),
				"VITE_FIXTURE=public-but-do-not-copy",
			);
			writeFileSync(join(root, ".dev.vars.example"), "APP_ENV=development");
			writeFileSync(
				join(root, "src", "fixture.ts"),
				"export const fixture=true",
			);
			writeFileSync(join(root, "src", "paraglide", "generated.js"), "fixture");
			symlinkSync(
				join(root, ".dev.vars"),
				join(root, "src", "linked-secret.ts"),
			);
			const target = prepareLocalSmoke(root);
			expect(readFileSync(join(root, ".dev.vars"), "utf8")).toBe(
				"NOT_A_REAL_SECRET=fixture-value",
			);
			expect(existsSync(join(target, ".dev.vars"))).toBe(false);
			expect(existsSync(join(target, ".env.production"))).toBe(false);
			expect(existsSync(join(target, ".dev.vars.example"))).toBe(true);
			expect(existsSync(join(target, "src", "fixture.ts"))).toBe(true);
			expect(existsSync(join(target, "src", "paraglide"))).toBe(false);
			expect(existsSync(join(target, "src", "linked-secret.ts"))).toBe(false);
			expect(existsSync(join(target, ".wrangler"))).toBe(false);
			expect(
				localSmokeEnvironment(target, {
					PATH: "/bin",
					SECRET_FIXTURE: "do-not-inherit",
					VITE_PAYMENT_PROVIDER: "stripe",
				}),
			).toEqual(
				expect.objectContaining({
					PATH: "/bin",
					CI: "true",
					VITE_BASE_URL: "http://127.0.0.1:4173",
				}),
			);
			expect(
				localSmokeEnvironment(target, { SECRET_FIXTURE: "do-not-inherit" }),
			).not.toHaveProperty("SECRET_FIXTURE");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("refuses an unrelated project before creating fixtures", () => {
		const root = mkdtempSync(join(tmpdir(), "smoke-unrelated-"));
		try {
			writeFileSync(join(root, "package.json"), '{"name":"unrelated"}');
			expect(() => prepareLocalSmoke(root)).toThrow("starter root");
			expect(existsSync(join(root, ".local-smoke"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
