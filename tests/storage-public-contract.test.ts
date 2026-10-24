import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { Bindings } from "../src/env";
vi.mock("../src/api/runtime.server", () => ({
	bindings: () => {
		throw Error("explicit fixture required");
	},
}));
vi.mock("@tanstack/react-start/server", () => ({
	getRequest: () => {
		throw Error("explicit fixture required");
	},
}));
vi.mock("../src/auth/index.server", () => ({
	requireUser: async (request: Request) => {
		const id = request.headers.get("x-fixture-user");
		if (!id) throw Error("Sign in required.");
		return { user: { id } };
	},
}));
import { createStorageFacade } from "../src/storage/public.server";
import { websiteConfig } from "../src/config/website";
describe("documented request-owned storage facade", () => {
	let mf: Miniflare;
	let env: Bindings;
	const objects = new Map<string, ArrayBuffer>();
	beforeAll(async () => {
		mf = new Miniflare(
			convertV4MiniflareOptions({
				modules: true,
				script: 'export default {fetch(){return new Response("fixture")}}',
				compatibilityDate: "2026-10-01",
				d1Databases: ["DB"],
			}),
		);
		const DB = (await mf.getD1Database("DB")) as unknown as D1Database;
		for (const file of (await readdir("drizzle"))
			.filter((f) => f.endsWith(".sql"))
			.sort())
			for (const sql of (await readFile(`drizzle/${file}`, "utf8"))
				.split("--> statement-breakpoint")
				.filter((s) => s.trim()))
				await DB.prepare(sql).run();
		for (const id of ["owner", "other"])
			await DB.prepare(
				"INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)",
			)
				.bind(id, id, `${id}@example.test`, 1, 0, 0)
				.run();
		env = {
			DB,
			APP_URL: "https://fixture.test",
			BUCKET: {
				put: async (key: string, bytes: ArrayBuffer) => {
					objects.set(key, bytes);
				},
				get: async (key: string) => {
					const value = objects.get(key);
					return value ? { body: new Blob([value]).stream() } : null;
				},
				head: async (key: string) =>
					objects.has(key) ? { httpEtag: '"fixture"' } : null,
				delete: async (key: string) => {
					objects.delete(key);
				},
			},
		} as unknown as Bindings;
	});
	afterAll(async () => {
		await mf?.dispose();
	});
	const facade = (user = "owner", origin = "https://fixture.test") =>
		createStorageFacade(() => ({
			env,
			request: new Request("https://fixture.test/api/fixture", {
				headers: { origin, "x-fixture-user": user },
			}),
		}));
	it("runs original buffer/options/key signatures against actual local D1", async () => {
		const service = facade();
		const bytes = new TextEncoder().encode("ordinary local fixture");
		const result = await service.uploadFile(bytes, "readme.txt", "text/plain", {
			folder: "uploads/docs",
			userId: "owner",
		});
		expect(result.key).toMatch(/^uploads\/docs\/owner\/.+\.txt$/);
		expect(result.metadata.userId).toBe("owner");
		expect(
			await new Response(await service.downloadFile(result.key)).text(),
		).toBe("ordinary local fixture");
		expect((await service.getFileInfo(result.key)).etag).toBe('"fixture"');
		expect(
			(await service.listUserFiles("owner")).objects.some(
				(row) => row.id === result.metadata.id,
			),
		).toBe(true);
		await expect(facade("other").getFileInfo(result.key)).rejects.toThrow(
			"File not found",
		);
		await expect(service.listUserFiles("other")).rejects.toThrow("identity");
		await service.deleteFile(result.key);
		await expect(service.downloadFile(result.key)).rejects.toThrow(
			"File not found",
		);
	});
	it("does not let compatibility options choose another owner or bypass mutation origin", async () => {
		const bytes = new TextEncoder().encode("fixture");
		await expect(
			facade().uploadFile(bytes, "readme.txt", "text/plain", {
				userId: "other",
			}),
		).rejects.toThrow("identity");
		await expect(
			facade("owner", "https://different.test").uploadFile(
				bytes,
				"readme.txt",
				"text/plain",
			),
		).rejects.toThrow("Same-origin");
	});
	it("honors disabled storage", async () => {
		const prior = websiteConfig.storage.enabled;
		Object.assign(websiteConfig.storage, { enabled: false });
		try {
			await expect(facade().listUserFiles("owner")).rejects.toThrow("disabled");
		} finally {
			Object.assign(websiteConfig.storage, { enabled: prior });
		}
	});
	it("uses the owner/cursor covering index for a bounded first page", async () => {
		const rows = await env.DB.prepare(
			"EXPLAIN QUERY PLAN SELECT id,created_at FROM userfiles WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 21",
		)
			.bind("owner")
			.all<{ detail: string }>();
		expect(rows.results.map((row) => row.detail).join(" ")).toContain(
			"userfiles_owner_cursor_idx",
		);
	});
});
