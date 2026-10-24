import { test, expect } from "@playwright/test";
test("configured third-party scripts cannot persist into auth/reset documents", async ({
	page,
}) => {
	const external: string[] = [];
	// No provider network request can leave this test, even when fixture IDs are enabled.
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.origin === "http://127.0.0.1:4173") {
			await route.continue();
			return;
		}
		external.push(url.href);
		await route.fulfill({
			status: 200,
			contentType: "application/javascript",
			body: "window.__privacyThirdPartyLoaded = true;",
		});
	});
	await page.goto("/");
	await expect(page.locator("#edgekit-google-analytics")).toHaveCount(1);
	await expect
		.poll(() =>
			page.evaluate(() =>
				Boolean(
					(window as Window & { __privacyThirdPartyLoaded?: boolean })
						.__privacyThirdPartyLoaded,
				),
			),
		)
		.toBe(true);
	await page.locator('header a[href*="/auth/login"]').click();
	await expect(page).toHaveURL(/\/auth\/login/);
	expect(
		await page.evaluate(() =>
			Boolean(
				(window as Window & { __privacyThirdPartyLoaded?: boolean })
					.__privacyThirdPartyLoaded,
			),
		),
	).toBe(false);
	await expect(
		page.locator("#edgekit-google-analytics,#edgekit-crisp"),
	).toHaveCount(0);
	for (const path of [
		"/auth/reset-password?token=privacy-fixture-not-real",
		"/zh/auth/reset-password?token=privacy-fixture-not-real",
		"/settings/security",
	]) {
		const before = external.length;
		const response = await page.goto(path);
		expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
		await expect(
			page.locator("#edgekit-google-analytics,#edgekit-crisp"),
		).toHaveCount(0);
		expect(
			await page.evaluate(() =>
				Boolean(
					(window as Window & { __privacyThirdPartyLoaded?: boolean })
						.__privacyThirdPartyLoaded,
				),
			),
		).toBe(false);
		await page.waitForTimeout(200);
		expect(external.length).toBe(before);
	}
	expect(
		external.every((url) => !url.includes("privacy-fixture-not-real")),
	).toBe(true);
});
