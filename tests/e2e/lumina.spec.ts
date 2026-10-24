import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { signInFixture } from "./browser-session";

const origin = "http://127.0.0.1:4173";
test.use({ actionTimeout: 10_000 });
async function evidence(page: Page, name: string) {
	const path = process.env.EDGEKIT_QA_EVIDENCE;
	if (!path) return;
	mkdirSync(path, { recursive: true });
	await page.screenshot({ path: resolve(path, `${name}.png`), fullPage: true });
}
test.beforeEach(async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	(page as Page & { luminaErrors?: string[] }).luminaErrors = errors;
});
test.afterEach(async ({ page }) => {
	expect((page as Page & { luminaErrors?: string[] }).luminaErrors).toEqual([]);
});

for (const width of [1440, 390]) {
	test(`@lumina ${width}px real login, model controls, double click, private result, download, reuse and cancel/delete`, async ({
		page,
		browser,
	}) => {
		test.setTimeout(90_000);
		await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
		await page.goto("/");
		await expect(page.getByText(/LOCAL FIXTURE/)).toBeVisible();
		await evidence(page, `lumina-home-${width}`);
		await signInFixture(page);
		await page.goto("/studio");
		await expect(page.locator("#image-model")).toBeEnabled();
		await page.locator("#image-model").selectOption("workers-flux-schnell");
		await expect(page.locator(".lm-ratios button")).toHaveCount(1);
		await expect(page.locator("#image-seed")).toHaveCount(0);
		await page.locator("#image-model").selectOption("fal-flux-schnell");
		await expect(page.locator(".lm-ratios button")).toHaveCount(5);
		const prompt = `Original local fixture ${width}`;
		await page.locator("#image-prompt").fill(prompt);
		let posts = 0;
		page.on("request", (request) => {
			if (
				request.method() === "POST" &&
				new URL(request.url()).pathname === "/api/generations"
			)
				posts++;
		});
		await page
			.getByRole("button", { name: /^Create image/ })
			.evaluate((button) => {
				(button as HTMLButtonElement).click();
				(button as HTMLButtonElement).click();
			});
		await expect(page.locator(".lm-result-image img")).toBeVisible({
			timeout: 20_000,
		});
		expect(posts).toBe(1);
		await evidence(page, `lumina-studio-${width}`);
		const imageUrl = await page
			.locator(".lm-result-image img")
			.getAttribute("src");
		expect(imageUrl).toMatch(/^\/api\/generations\//);
		const privateResponse = await page.request.get(imageUrl || "");
		expect(privateResponse.headers()["cache-control"]).toContain("private");
		const foreign = await browser.newContext();
		const foreignPage = await foreign.newPage();
		await foreignPage.goto(origin);
		await signInFixture(foreignPage, "other");
		expect((await foreignPage.request.get(origin + imageUrl)).status()).toBe(
			404,
		);
		await foreign.close();
		const download = page.waitForEvent("download");
		await page
			.getByRole("link", { name: "Download image", exact: true })
			.click();
		expect((await download).suggestedFilename()).toMatch(/^lumina-.*\.png$/);
		await page.goto("/library");
		await page
			.getByRole("link", { name: `View creation: ${prompt}`, exact: true })
			.click();
		await page.reload();
		await expect(page.locator(".lm-result-image img")).toBeVisible();
		await evidence(page, `lumina-detail-${width}`);
		await page.getByRole("link", { name: "Reuse prompt", exact: true }).click();
		await expect(page.locator("#image-prompt")).toHaveValue(prompt);
		await page.goBack();
		await page
			.getByRole("button", { name: "Delete this creation", exact: true })
			.click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: "Keep it", exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(page.locator(".lm-result-image img")).toBeVisible();
		await page
			.getByRole("button", { name: "Delete this creation", exact: true })
			.click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Delete permanently", exact: true })
			.click();
		await expect(page).toHaveURL(/\/library$/);
		expect((await page.request.get(imageUrl || "")).status()).toBe(404);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth + 1,
			),
		).toBe(true);
	});
}

test("@lumina refresh restores one interrupted request using its exact idempotency key", async ({
	page,
}) => {
	await signInFixture(page);
	await page.goto("/studio");
	await page.locator("#image-prompt").fill("Interrupted local fixture");
	let recorded: { job: { id: string } } | undefined;
	let key: string | undefined;
	await page.route("**/api/generations", async (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		key = route.request().postDataJSON().idempotencyKey;
		const response = await route.fetch();
		recorded = await response.json();
		await route.abort("failed");
	});
	await page.getByRole("button", { name: /^Create image/ }).click();
	await expect(
		page.getByRole("button", { name: /Recover same request/ }),
	).toBeVisible();
	await page.unroute("**/api/generations");
	await page.reload();
	const recovered = page.waitForRequest(
		(request) =>
			request.method() === "POST" &&
			new URL(request.url()).pathname === "/api/generations",
	);
	await page.getByRole("button", { name: /Recover same request/ }).click();
	expect((await recovered).postDataJSON().idempotencyKey).toBe(key);
	await expect(page.locator(".lm-result-image img")).toHaveAttribute(
		"src",
		`/api/generations/${recorded?.job.id}/asset`,
		{ timeout: 20_000 },
	);
});

test("@lumina failures and unknown outcomes retain honest state, ownership and concurrency", async ({
	page,
}) => {
	await signInFixture(page, "admin");
	const create = async (prompt: string, key = crypto.randomUUID()) => {
		const response = await page.request.post("/api/generations", {
			headers: { origin },
			data: {
				model: "fal-flux-schnell",
				prompt,
				aspectRatio: "1:1",
				idempotencyKey: key,
			},
		});
		return { response, body: await response.json() };
	};
	const failed = await create("[fixture:fail]");
	expect(failed.body.job.status).toBe("failed");
	expect(failed.body.usage.reserved).toBe(0);
	const unknownKey = crypto.randomUUID();
	const unknown = await create("[fixture:unknown]", unknownKey);
	expect(unknown.body.job.status).toBe("unknown");
	const replay = await create("[fixture:unknown]", unknownKey);
	expect(replay.body.job.id).toBe(unknown.body.job.id);
	const conflict = await create("Different prompt", unknownKey);
	expect(conflict.response.status()).toBe(409);
	const pending = await create("[fixture:pending]");
	expect(pending.body.job.status).toBe("queued");
	expect((await create("third request")).response.status()).toBe(429);
	await page.goto(`/library/${unknown.body.job.id}`);
	await expect(
		page.locator(".lm-status").filter({ hasText: "Needs a status check" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Delete this creation", exact: true }),
	).toHaveCount(0);
	await evidence(page, "lumina-unknown");
	await page.goto("/admin/generations");
	await expect(page.locator("main")).toContainText(unknown.body.job.id);
	await evidence(page, "lumina-admin");
	expect(
		(
			await page.request.post("/api/ai", {
				headers: { origin },
				data: { task: "fal-image" },
			})
		).status(),
	).toBe(410);
});

test("@lumina Chinese mobile Studio and private library are translated and named", async ({
	page,
}) => {
	await signInFixture(page, "cursor");
	await page.setViewportSize({ width: 390, height: 844 });
	for (const path of [
		"/zh/studio",
		"/zh/library",
		"/zh/settings/profile",
		"/zh/pricing",
	]) {
		await page.goto(path);
		await expect(page.locator("html")).toHaveAttribute("lang", "zh");
		await expect(page.locator("main h1")).toHaveCount(1);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth + 1,
			),
		).toBe(true);
		await evidence(page, `lumina-zh-${path.split("/").pop()}`);
	}
});
