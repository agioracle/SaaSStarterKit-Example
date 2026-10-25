import { fixtureOrigin } from "./environment";
import { test, expect } from "@playwright/test";
test("@http built Worker health and native bindings", async ({ request }) => {
	const response = await request.get("/api/health");
	expect(response.status()).toBe(200);
	expect(await response.json()).toEqual({
		status: "ok",
		runtime: "Cloudflare Workers",
		bindings: { db: true, storage: true, cache: true },
	});
});
test("@http English and Chinese SSR include actual content and client assets", async ({
	request,
}) => {
	for (const path of [
		"/",
		"/zh",
		"/blog",
		"/zh/blog",
		"/auth/login",
		"/zh/auth/login",
	]) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(200);
		const html = await response.text();
		expect(html).toContain("Lumina");
		expect(html).toContain("<script");
		expect(html).toContain("stylesheet");
		expect(html).not.toContain("Internal Server Error");
		if (path.startsWith("/zh")) expect(html).toContain('lang="zh"');
		else expect(html).toContain('lang="en"');
	}
	const html = await (await request.get("/")).text();
	const asset = html.match(/href="([^"]+\.css)"/);
	expect(asset).toBeTruthy();
	expect((await request.get(asset?.[1] || "")).status()).toBe(200);
});
test("@http protected SSR redirects and invalid locale/path does not leak secrets", async ({
	request,
}) => {
	for (const path of ["/settings/profile", "/zh/settings/profile"]) {
		const result = await request.get(path, { maxRedirects: 0 });
		expect([302, 303, 307, 308]).toContain(result.status());
		expect(result.headers().location).toContain(
			path.startsWith("/zh") ? "/zh/auth/login" : "/auth/login",
		);
		expect(result.headers()["cache-control"]).toContain("no-store");
	}
	expect((await request.get("/unknown-page-for-test")).status()).toBe(404);
});
test("@http authenticated SSR uses verified D1 session", async ({
	request,
}) => {
	const login = await request.post("/api/auth/sign-in/email", {
		headers: { origin: fixtureOrigin },
		data: {
			email: "e2e.member@example.invalid",
			password: "E2eFixturePassword!23",
		},
	});
	expect(login.ok(), await login.text()).toBeTruthy();
	const result = await request.get("/settings/profile");
	expect(result.status()).toBe(200);
	const body = await result.text();
	expect(body).toContain("E2E member");
	expect(body).not.toContain("E2eFixturePassword");
});
test("@http disabled webhook and extension origin boundaries", async ({
	request,
}) => {
	const hook = await request.post("/api/webhooks/stripe", {
		data: { fake: true },
	});
	expect(hook.status()).toBe(404);
	expect(await hook.text()).toBe("Not found");
	const extension = await request.post("/api/extension/auth/google", {
		headers: { origin: "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
		data: { accessToken: "not-real" },
	});
	expect(extension.status()).toBe(403);
});
test("@http public info, localized article and crawler metadata are served", async ({
	request,
}) => {
	for (const path of [
		"/about",
		"/contact",
		"/changelog",
		"/roadmap",
		"/waitlist",
		"/privacy",
		"/terms",
		"/cookie",
		"/zh/about",
		"/zh/privacy",
	])
		expect((await request.get(path)).status(), path).toBe(200);
	const sitemap = await request.get("/sitemap.xml");
	expect(sitemap.status()).toBe(200);
	expect(sitemap.headers()["content-type"]).toContain("xml");
	const xml = await sitemap.text();
	expect(xml).toContain("/zh/blog/a-thoughtful-foundation");
	expect(xml).toContain("/privacy");
	expect(xml).not.toContain("/settings");
	expect(xml).not.toContain("/auth");
	expect(xml).not.toContain("/pricing");
	const robots = await request.get("/robots.txt");
	expect(robots.status()).toBe(200);
	expect(await robots.text()).toContain("Disallow: /api/");
	const article = await request.get("/zh/blog/a-thoughtful-foundation");
	expect(article.status()).toBe(200);
	const html = await article.text();
	expect(html).toContain('lang="zh"');
	expect(html).toContain("/zh/blog/a-thoughtful-foundation");
	for (const path of ["/favicon.svg", "/manifest.webmanifest"])
		expect((await request.get(path)).status()).toBe(200);
});

test("@http auth reset pages have a no-referrer response policy", async ({
	request,
}) => {
	for (const path of [
		"/auth/reset-password?token=not-a-real-secret",
		"/zh/auth/reset-password?token=not-a-real-secret",
	]) {
		const response = await request.get(path);
		expect(response.status()).toBe(200);
		expect(response.headers()["referrer-policy"]).toBe("no-referrer");
		expect(response.headers()["cache-control"]).toContain("no-store");
		expect(response.headers()["x-frame-options"]).toBe("DENY");
	}
});
test("@http async API failures preserve safe status and JSON envelope", async ({
	request,
}) => {
	await request.post("/api/auth/sign-in/email", {
		headers: { origin: fixtureOrigin },
		data: {
			email: "e2e.member@example.invalid",
			password: "E2eFixturePassword!23",
		},
	});
	const missing = await request.get(
		"/api/files/00000000-0000-4000-8000-000000000001",
	);
	expect(missing.status()).toBe(404);
	expect(await missing.json()).toMatchObject({
		error: "File not found.",
		code: "HTTP_ERROR",
		requestId: expect.any(String),
	});
	const invalid = await request.post("/api/ai", {
		headers: { origin: fixtureOrigin },
		data: { task: "summarize", text: "short" },
	});
	expect(invalid.status()).toBe(410);
	expect(await invalid.json()).toMatchObject({ code: "HTTP_ERROR" });
	const unconfigured = await request.post("/api/ai", {
		headers: { origin: fixtureOrigin },
		data: { task: "summarize", text: "a".repeat(80) },
	});
	expect(unconfigured.status()).toBe(410);
	expect(await unconfigured.json()).toMatchObject({ code: "HTTP_ERROR" });
	const newsletter = await request.get("/api/newsletter");
	expect(newsletter.status()).toBe(404);
	expect(await newsletter.json()).toMatchObject({ code: "HTTP_ERROR", error: "Newsletter disabled." });
});

test("@http localized homepage/blog retain shared structured-data graphs", async ({
	request,
}) => {
	for (const path of [
		"/",
		"/zh",
		"/blog",
		"/zh/blog",
		"/zh/blog/a-thoughtful-foundation",
	]) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(200);
		const html = await response.text();
		const documents = [
			...html.matchAll(
				/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
			),
		].map((match) => JSON.parse(match[1]));
		const nodes = documents.flatMap((value) => value["@graph"] || [value]);
		for (const type of [
			"Organization",
			"WebSite",
			path.endsWith("/blog") ? "CollectionPage" : "WebPage",
		])
			expect(
				nodes.some((node) => node["@type"] === type),
				`${path} ${type}`,
			).toBe(true);
		if (path === "/zh/blog") {
			const blog = nodes.find((node) => node["@type"] === "Blog");
			expect(new URL(blog.url).pathname).toBe("/zh/blog");
		}
		if (path.includes("a-thoughtful-foundation")) {
			const article = nodes.find((node) => node["@type"] === "BlogPosting");
			expect(article.inLanguage).toBe("zh");
			expect(new URL(article.url).pathname).toBe(path);
		}
	}
	const auth = await (await request.get("/zh/auth/login")).text();
	expect(auth).not.toContain("application/ld+json");
	expect(auth).not.toContain("<title>Sign in");
});

test("@http readiness is read-only, minimal publicly and admin-scoped in detail", async ({
	request,
}) => {
	const publicReady = await request.get("/api/ready");
	expect(publicReady.status()).toBe(503);
	const body = await publicReady.json();
	expect(Object.keys(body).sort()).toEqual(["requestId", "status"]);
	expect(body.status).toBe("not_ready");
	expect(publicReady.headers()["x-request-id"]).toBe(body.requestId);
	expect((await request.get("/api/admin/readiness")).status()).toBe(401);
	const memberLogin = await request.post("/api/auth/sign-in/email", {
		headers: {
			origin: fixtureOrigin,
			"cf-connecting-ip": "192.0.2.100",
		},
		data: {
			email: "e2e.cursor@example.invalid",
			password: "E2eFixturePassword!23",
		},
	});
	expect(memberLogin.status(), await memberLogin.text()).toBe(200);
	expect((await request.get("/api/admin/readiness")).status()).toBe(403);
	await request.post("/api/auth/sign-out", {
		headers: {
			origin: fixtureOrigin,
			"cf-connecting-ip": "192.0.2.100",
		},
		data: {},
	});
	const adminLogin = await request.post("/api/auth/sign-in/email", {
		headers: {
			origin: fixtureOrigin,
			"cf-connecting-ip": "192.0.2.100",
		},
		data: {
			email: "e2e.admin@example.invalid",
			password: "E2eFixturePassword!23",
		},
	});
	expect(adminLogin.status(), await adminLogin.text()).toBe(200);
	const admin = await request.get("/api/admin/readiness");
	expect(admin.status()).toBe(200);
	expect(await admin.json()).toMatchObject({
		status: "not_ready",
		checks: { database: true, migrations: true, authConfiguration: true },
		features: { aiEnabled: false },
		scope: "local-bindings-schema-and-configuration-only",
	});
});

test("@http public contracts: clean blog canonical, configured login methods and production gallery boundary", async ({
	request,
}) => {
	for (const path of ["/blog", "/zh/blog"]) {
		const response = await request.get(path, { maxRedirects: 0 });
		expect(response.status(), path).toBe(200);
		const html = await response.text();
		const canonical = html.match(/rel="canonical" href="([^"]+)"/)?.[1];
		expect(canonical).toBeTruthy();
		const target = new URL(canonical || "http://invalid.test");
		expect(target.pathname).toBe(path);
		expect(target.search).toBe("");
	}
	const login = await request.get("/auth/login");
	expect(await login.text()).not.toContain('class="google-mark"');
	const gallery = await request.get("/developer/components", {
		maxRedirects: 0,
	});
	expect(gallery.status()).toBe(404);
	const png = await request.get("/og.png");
	expect(png.status()).toBe(200);
	expect(png.headers()["content-type"]).toContain("image/png");
	const root = await request.get("/");
	const html = await root.text();
	const hashed = html.match(
		/(?:href|src)="(\/assets\/[^"?#]+-[A-Za-z0-9_-]+\.(?:js|css))"/,
	);
	expect(hashed).toBeTruthy();
	const asset = await request.get(hashed?.[1] || "/missing");
	expect(asset.status()).toBe(200);
	expect(asset.headers()["cache-control"]).toContain("immutable");
	expect(
		(await request.get("/logo.svg")).headers()["cache-control"] || "",
	).not.toContain("immutable");
	expect(root.headers()["cache-control"]).toContain("no-store");
});
