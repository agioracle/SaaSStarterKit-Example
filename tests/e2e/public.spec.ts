import { test, expect } from "@playwright/test";
test("@browser production Worker health and initial rendered-page smoke", async ({ request, page }) => {
	const response = await request.get("/api/health");
	expect(response.ok()).toBeTruthy();
	expect(await response.json()).toMatchObject({
		status: "ok",
		runtime: "Cloudflare Workers",
		bindings: { db: true, storage: true, cache: true },
	});
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await expect(page.locator("body")).toContainText("Lumina");
	expect(errors).toEqual([]);
});
test("@http protected APIs never expose data without a configured session", async ({
	request,
}) => {
	for (const path of [
		"/api/me",
		"/api/files",
		"/api/payments",
		"/api/newsletter",
	]) {
		const response = await request.get(path);
		expect([401, 503]).toContain(response.status());
		expect(await response.text()).not.toContain("token");
	}
	const response = await request.post("/api/ai", {
		headers: { origin: "https://evil.example" },
		data: { task: "summarize", text: "x".repeat(60) },
	});
	expect(response.status()).toBe(403);
});
test("@browser English and Chinese document-navigation smoke (not an interaction test)", async ({
	page,
}) => {
	await page.goto("/zh");
	await expect(page.locator("html")).toHaveAttribute("lang", /zh/);
	await expect(page.locator("body")).not.toContainText("Internal Server Error");
	await page.goto("/blog");
	await expect(page.locator("body")).not.toContainText("Internal Server Error");
});
