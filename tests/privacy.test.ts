import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { isSensitivePath } from "../src/components/analytics/privacy";
const source = (path: string) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
		.replace(/\s+/g, "")
		.replaceAll('"', "'");
describe("third-party telemetry privacy boundary", () => {
	it("excludes localized credential and private-data routes", () => {
		for (const path of [
			"/auth/reset-password",
			"/zh/auth/reset-password",
			"/settings/apikeys",
			"/zh/settings/security",
			"/admin/users",
			"/dashboard",
			"/ai",
			"/contact",
			"/waitlist",
			"/%61uth/reset-password",
			"/%E0%A4%A",
		])
			expect(isSensitivePath(path), path).toBe(true);
		for (const path of ["/", "/zh", "/blog", "/zh/blog/a", "/pricing"])
			expect(isSensitivePath(path), path).toBe(false);
	});
	it("sends pathname rather than query/hash and guards every injector", () => {
		const analytics = source("src/components/analytics/analytics.tsx");
		expect(analytics).not.toContain("window.location.href");
		expect(analytics).not.toContain("s.location.href");
		expect(analytics).toContain(
			"window.location.origin+window.location.pathname",
		);
		expect(
			analytics.match(/isSensitivePath\(window.location.pathname\)/g),
		).toHaveLength(4);
		expect(source("src/components/chatbox/crisp-chat.tsx")).toContain(
			"isSensitivePath(window.location.pathname)",
		);
	});
	it("keeps auth document boundaries and no-referrer response middleware", () => {
		expect(source("src/components/layout/shell.tsx")).toMatch(
			/to='\/auth\/login'reloadDocument/,
		);
		expect(source("src/components/layout/shell.tsx")).toMatch(
			/to='\/auth\/register'reloadDocument/,
		);
		expect(source("src/routes/_app.tsx")).toContain("reloadDocument:true");
		expect(source("src/middlewares/security.ts")).toContain(
			"'Referrer-Policy','no-referrer'",
		);
		expect(source("src/start.ts")).toContain(
			"securityHeaders,createCsrfMiddleware",
		);
	});
});
