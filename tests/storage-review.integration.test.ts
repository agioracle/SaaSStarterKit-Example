import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	it,
	expect,
	vi,
} from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { websiteConfig } from "../src/config/website";
import { uploadFile } from "../src/storage/index.server";
import { handleFiles } from "../src/api/files.server";
import {
	validateUpload,
	validateMagicBytes,
	downloadContentType,
} from "../src/storage";
import type { Bindings } from "../src/env";
vi.mock("@tanstack/react-start/server-only", () => ({}));
describe("unrestricted extensions with safe attachment downloads", () => {
	let mf: Miniflare;
	let env: Bindings;
	const objects = new Map<string, ArrayBuffer>();
	const defaults = [...websiteConfig.storage.allowedTypes];
	beforeAll(async () => {
		mf = new Miniflare(
			convertV4MiniflareOptions({
				modules: true,
				script: 'export default {fetch(){return new Response("fixture")}}',
				compatibilityDate: "2026-10-01",
				d1Databases: ["DB"],
			}),
		);
		const db = (await mf.getD1Database("DB")) as unknown as D1Database;
		for (const filename of (await readdir("drizzle"))
			.filter((name) => name.endsWith(".sql"))
			.sort())
			for (const sql of (await readFile(`drizzle/${filename}`, "utf8"))
				.split("--> statement-breakpoint")
				.map((s) => s.trim())
				.filter(Boolean))
				await db.prepare(sql).run();
		await db
			.prepare(
				"INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)",
			)
			.bind("owner", "Fixture", "owner@example.test", 1, Date.now(), Date.now())
			.run();
		env = {
			DB: db,
			BUCKET: {
				put: async (key: string, bytes: ArrayBuffer) => {
					objects.set(key, bytes);
				},
				get: async (key: string) =>
					objects.has(key) ? { body: objects.get(key) } : null,
				delete: async (key: string) => {
					objects.delete(key);
				},
			},
		} as unknown as Bindings;
	});
	beforeEach(async () => {
		Object.assign(websiteConfig.storage, { allowedTypes: [] });
		objects.clear();
		await env.DB.prepare("DELETE FROM userfiles").run();
	});
	afterAll(async () => {
		Object.assign(websiteConfig.storage, { allowedTypes: defaults });
		await mf?.dispose();
	});
	it.each([{ allowed: [] }, { allowed: [".txt"] }, { allowed: ["TXT"] }])(
		"uploads text with allowlist $allowed and returns an opaque owned attachment",
		async ({ allowed }) => {
			Object.assign(websiteConfig.storage, { allowedTypes: allowed });
			const uploaded = await uploadFile(
				env,
				"owner",
				new File(["hello 文本"], "note.txt", { type: "text/plain" }),
			);
			const response = await handleFiles(
				new Request(`https://local.test/api/files/${uploaded.id}`),
				env,
				"owner",
				uploaded.id,
			);
			expect(response.headers.get("content-type")).toBe(
				"application/octet-stream",
			);
			expect(response.headers.get("content-disposition")).toMatch(
				/^attachment;/,
			);
			expect(response.headers.get("content-security-policy")).toContain(
				"sandbox",
			);
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(await response.text()).toBe("hello 文本");
			await expect(
				handleFiles(
					new Request(`https://local.test/api/files/${uploaded.id}`),
					env,
					"another-owner",
					uploaded.id,
				),
			).rejects.toMatchObject({ status: 404 });
		},
	);
	it.each([
		["page.html", "text/html", "<script>alert(1)</script>"],
		["vector.svg", "image/svg+xml", "<svg/>"],
		["archive.custom", "application/x-custom", "arbitrary bytes"],
		["README", "", "plain bytes"],
		["inferred.txt", "", "plain text with inferred MIME"],
	])("allows %s only as an opaque attachment", async (name, type, body) => {
		const uploaded = await uploadFile(
			env,
			"owner",
			new File([body], name, { type }),
		);
		const response = await handleFiles(
			new Request(`https://local.test/api/files/${uploaded.id}`),
			env,
			"owner",
			uploaded.id,
		);
		expect(response.headers.get("content-type")).toBe(
			"application/octet-stream",
		);
		expect(await response.text()).toBe(body);
	});
	it("retains MIME, magic, extension, size, filename and UTF8 validation", () => {
		expect(() =>
			validateUpload({ name: "note.txt", type: "image/png", size: 8 }, [], 100),
		).toThrow();
		expect(() =>
			validateUpload(
				{ name: "note.png", type: "text/plain", size: 8 },
				[],
				100,
			),
		).toThrow();
		expect(() =>
			validateMagicBytes(new TextEncoder().encode("not png"), "image/png"),
		).toThrow();
		expect(() =>
			validateMagicBytes(new Uint8Array([255, 0]), "text/plain"),
		).toThrow();
		expect(() =>
			validateMagicBytes(new TextEncoder().encode("{bad"), "application/json"),
		).toThrow();
		expect(() =>
			validateUpload(
				{ name: "../note.txt", type: "text/plain", size: 8 },
				[],
				100,
			),
		).toThrow();
		expect(() =>
			validateUpload(
				{ name: "note.txt", type: "text/plain", size: 101 },
				[],
				100,
			),
		).toThrow();
		expect(() =>
			validateUpload(
				{ name: "note.txt", type: "text/plain", size: 8 },
				["pdf"],
				100,
			),
		).toThrow();
		expect(downloadContentType("image/png")).toBe("image/png");
	});
});
