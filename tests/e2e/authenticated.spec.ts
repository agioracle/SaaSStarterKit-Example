import { test, expect, type APIRequestContext } from "@playwright/test";
async function login(request: APIRequestContext, role: string) {
	const response = await request.post("/api/auth/sign-in/email", {
		headers: { origin: "http://127.0.0.1:4173" },
		data: {
			email: `e2e.${role}@example.invalid`,
			password: "E2eFixturePassword!23",
		},
	});
	expect(response.status(), await response.text()).toBe(200);
}
test("@browser HTTP fixture login and protected profile-render smoke (not form interaction)", async ({
	page,
}) => {
	await login(page.request, "member");
	const me = await page.request.get("/api/me");
	expect(me.ok()).toBeTruthy();
	const data = await me.json();
	expect(data.user.id).toBe("e2e-member");
	expect(data.session.token).toBeUndefined();
	await page.goto("/settings/profile");
	await expect(page.locator("body")).toContainText("E2E member");
});
test("@http API keys reveal once, verify and revoke", async ({ request }) => {
	await login(request, "member");
	const headers = { origin: "http://127.0.0.1:4173" };
	const created = await request.post("/api/auth/api-key/create", {
		headers,
		data: { name: "E2E integration" },
	});
	expect(created.status(), await created.text()).toBe(200);
	const key = await created.json();
	expect(key.key).toBeTruthy();
	const list = await request.get("/api/auth/api-key/list");
	expect(await list.text()).not.toContain(key.key);
	const verified = await request.get("/api/v1/user", {
		headers: { "x-api-key": key.key },
	});
	expect(verified.status(), await verified.text()).toBe(200);
	const removed = await request.post("/api/auth/api-key/delete", {
		headers,
		data: { keyId: key.id },
	});
	expect(removed.ok(), await removed.text()).toBeTruthy();
	expect(
		(
			await request.get("/api/v1/user", { headers: { "x-api-key": key.key } })
		).status(),
	).toBe(401);
});
test("@http R2 uploads enforce owner on download and deletion", async ({
	request,
	playwright,
}) => {
	await login(request, "member");
	const bytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZL0AAAAASUVORK5CYII=",
		"base64",
	);
	const uploaded = await request.post("/api/files", {
		headers: { origin: "http://127.0.0.1:4173" },
		multipart: {
			file: { name: "avatar.png", mimeType: "image/png", buffer: bytes },
		},
	});
	expect(uploaded.status(), await uploaded.text()).toBe(201);
	const file = await uploaded.json();
	expect((await request.get(file.url)).status()).toBe(200);
	const other = await playwright.request.newContext({
		baseURL: "http://127.0.0.1:4173",
	});
	await login(other, "other");
	expect((await other.get(file.url)).status()).toBe(404);
	expect(
		(
			await other.delete("/api/files", {
				headers: { origin: "http://127.0.0.1:4173" },
				data: { id: file.id },
			})
		).status(),
	).toBe(404);
	await other.dispose();
	expect(
		(
			await request.delete("/api/files", {
				headers: { origin: "http://127.0.0.1:4173" },
				data: { id: file.id },
			})
		).ok(),
	).toBeTruthy();
	expect((await request.get(file.url)).status()).toBe(404);
});
test("@http admin gate and ban revoke member access immediately", async ({
	request,
	playwright,
}) => {
	await login(request, "admin");
	const member = await playwright.request.newContext({
		baseURL: "http://127.0.0.1:4173",
	});
	await login(member, "other");
	expect((await member.get("/api/auth/admin/list-users")).status()).toBe(403);
	const headers = { origin: "http://127.0.0.1:4173" };
	const ban = await request.post("/api/auth/admin/ban-user", {
		headers,
		data: { userId: "e2e-other", banReason: "E2E only", banExpiresIn: 60 },
	});
	expect(ban.status(), await ban.text()).toBe(200);
	expect([401, 403]).toContain((await member.get("/api/me")).status());
	const banned = await request.get(
		"/api/auth/admin/list-users?filterField=banned&filterValue=true&filterOperator=eq",
	);
	expect(banned.ok()).toBeTruthy();
	expect(
		(await banned.json()).users.map((u: { id: string }) => u.id),
	).toContain("e2e-other");
	const active = await request.get(
		"/api/auth/admin/list-users?filterField=banned&filterValue=false&filterOperator=eq",
	);
	expect(active.ok()).toBeTruthy();
	expect(
		(await active.json()).users.map((u: { id: string }) => u.id),
	).not.toContain("e2e-other");
	const unban = await request.post("/api/auth/admin/unban-user", {
		headers,
		data: { userId: "e2e-other" },
	});
	expect(unban.ok(), await unban.text()).toBeTruthy();
	await member.dispose();
});
test("@http configurable R2 folder metadata and cursor errors are bounded", async ({
	request,
}) => {
	await login(request, "member");
	const bytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZL0AAAAASUVORK5CYII=",
		"base64",
	);
	const headers = { origin: "http://127.0.0.1:4173" };
	const invalid = await request.post("/api/files", {
		headers,
		multipart: {
			folder: "../forbidden",
			file: { name: "image.png", mimeType: "image/png", buffer: bytes },
		},
	});
	expect(invalid.status()).toBe(400);
	const uploaded = await request.post("/api/files", {
		headers,
		multipart: {
			folder: "userfiles/avatars",
			file: { name: "image.png", mimeType: "image/png", buffer: bytes },
		},
	});
	expect(uploaded.status()).toBe(201);
	const file = await uploaded.json();
	const info = await request.get(`${file.url}?info=1`);
	expect(info.status()).toBe(200);
	const metadata = await info.json();
	expect(metadata.id).toBe(file.id);
	expect(metadata.key).toBeUndefined();
	expect(metadata.etag).toBeTruthy();
	const avatar = await request.post("/api/auth/update-user", {
		headers,
		data: { image: file.url },
	});
	expect(avatar.status(), await avatar.text()).toBe(200);
	expect((await request.get("/api/files?cursor=bad")).status()).toBe(400);
	expect((await request.get("/api/files?limit=10000")).status()).toBe(400);
	await request.post("/api/auth/update-user", {
		headers,
		data: { image: null },
	});
	await request.delete("/api/files", { headers, data: { id: file.id } });
});
test("@http R2 keyset cursors visit owned files without duplicates", async ({
	request,
}) => {
	await login(request, "cursor");
	const headers = { origin: "http://127.0.0.1:4173" };
	const bytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZL0AAAAASUVORK5CYII=",
		"base64",
	);
	const ids: string[] = [];
	for (let index = 0; index < 3; index++) {
		const response = await request.post("/api/files", {
			headers,
			multipart: {
				file: {
					name: `cursor-${index}.png`,
					mimeType: "image/png",
					buffer: bytes,
				},
			},
		});
		expect(response.status()).toBe(201);
		ids.push((await response.json()).id);
	}
	const first = await (await request.get("/api/files?limit=2")).json();
	expect(first.files).toHaveLength(2);
	expect(first.hasMore).toBe(true);
	const second = await (
		await request.get(
			`/api/files?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
		)
	).json();
	expect(second.files).toHaveLength(1);
	expect(second.hasMore).toBe(false);
	expect(
		new Set(
			[...first.files, ...second.files].map((file: { id: string }) => file.id),
		),
	).toEqual(new Set(ids));
	for (const id of ids)
		expect(
			(await request.delete("/api/files", { headers, data: { id } })).ok(),
		).toBe(true);
});

test("@http arbitrary extension upload remains a private opaque attachment", async ({
	request,
}) => {
	await login(request, "member");
	const headers = { origin: "http://127.0.0.1:4173" };
	const created = await request.post("/api/files", {
		headers,
		multipart: {
			file: {
				name: "local-test.html",
				mimeType: "text/html",
				buffer: Buffer.from("<p>local fixture, not executable</p>"),
			},
		},
	});
	expect(created.status(), await created.text()).toBe(201);
	const file = await created.json();
	try {
		const downloaded = await request.get(`/api/files/${file.id}`);
		expect(downloaded.status()).toBe(200);
		expect(downloaded.headers()["content-type"]).toBe(
			"application/octet-stream",
		);
		expect(downloaded.headers()["content-disposition"]).toContain("attachment");
		expect(downloaded.headers()["content-security-policy"]).toContain(
			"sandbox",
		);
		expect(downloaded.headers()["x-content-type-options"]).toBe("nosniff");
		expect(await downloaded.text()).toContain("local fixture");
	} finally {
		expect(
			(
				await request.delete("/api/files", { headers, data: { id: file.id } })
			).ok(),
		).toBe(true);
	}
});
