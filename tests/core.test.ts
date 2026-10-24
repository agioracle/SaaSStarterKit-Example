import { describe, it, expect, vi } from "vitest";
import { safeReturnUrl, assertSameOrigin, readJson } from "../src/lib/security";
import { authEnvironment } from "../src/env";
import { getOrSetCache, invalidateCache } from "../src/cache";
import { validateUpload, validateMagicBytes } from "../src/storage";
describe("security boundaries", () => {
	it("allows only same-origin redirects", () => {
		expect(safeReturnUrl("/settings/billing", "https://app.example")).toBe(
			"https://app.example/settings/billing",
		);
		for (const input of [
			"https://evil.example",
			"//evil.example",
			"javascript:alert(1)",
			"https://app.example@evil.example",
		])
			expect(() => safeReturnUrl(input, "https://app.example")).toThrow();
	});
	it("requires origin for mutations", () => {
		expect(() =>
			assertSameOrigin(
				new Request("https://app.example/api"),
				"https://app.example",
			),
		).toThrow();
		expect(() =>
			assertSameOrigin(
				new Request("https://app.example/api", {
					headers: { origin: "https://evil.example" },
				}),
				"https://app.example",
			),
		).toThrow();
	});
	it("rejects unsafe auth secrets", () => {
		for (const value of [
			undefined,
			"short",
			"replace-this-secret-with-long-value",
			"better-auth-secret-12345678901234567890",
		])
			expect(() =>
				authEnvironment({ BETTER_AUTH_SECRET: value } as never),
			).toThrow();
	});
	it("bounds untrusted request bodies", async () => {
		await expect(
			readJson(
				new Request("http://localhost", {
					method: "POST",
					body: "x".repeat(25),
				}),
				20,
			),
		).rejects.toThrow("Request too large");
	});
});
describe("cache", () => {
	it("returns cached value without fetch", async () => {
		const fetch = vi.fn();
		expect(
			await getOrSetCache(
				{ get: async () => ({ ok: true }), put: vi.fn(), delete: vi.fn() },
				"key",
				fetch,
			),
		).toEqual({ ok: true });
		expect(fetch).not.toHaveBeenCalled();
	});
	it("fails open but never swallows source errors", async () => {
		const cache = {
			get: async () => {
				throw Error("cache down");
			},
			put: async () => {
				throw Error("cache down");
			},
			delete: async () => {
				throw Error("cache down");
			},
		};
		expect(await getOrSetCache(cache, "x", async () => 42)).toBe(42);
		await expect(
			getOrSetCache(cache, "x", async () => {
				throw Error("source failure");
			}),
		).rejects.toThrow("source failure");
		await expect(invalidateCache(cache, "x")).resolves.toBeUndefined();
	});
});
describe("uploads", () => {
	it("checks size extension MIME and magic independently", () => {
		expect(
			validateUpload(
				{ name: "avatar.PNG", size: 8, type: "image/png" },
				["png"],
				10,
			).extension,
		).toBe("png");
		expect(() =>
			validateUpload(
				{ name: "x.svg", size: 8, type: "image/svg+xml" },
				["png"],
				10,
			),
		).toThrow();
		expect(() =>
			validateUpload(
				{ name: "../x.png", size: 8, type: "image/png" },
				["png"],
				10,
			),
		).toThrow();
		expect(() =>
			validateUpload(
				{ name: "x.png", size: 100, type: "image/png" },
				["png"],
				10,
			),
		).toThrow();
		expect(() =>
			validateMagicBytes(new Uint8Array([60, 115, 99, 114]), "image/png"),
		).toThrow();
		expect(() =>
			validateMagicBytes(
				new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
				"image/png",
			),
		).not.toThrow();
	});
});
import {
	extensionOrigins,
	assertExtensionAudience,
	verifyGoogleExtensionToken,
} from "../src/auth/extension";
describe("extension authentication", () => {
	it("requires exact origins and correct Google audience", () => {
		expect(
			extensionOrigins("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
		).toHaveLength(1);
		expect(() => extensionOrigins("chrome-extension://*")).toThrow();
		expect(() =>
			assertExtensionAudience({ aud: "wrong", expires_in: 300 }, "expected"),
		).toThrow();
		expect(() =>
			assertExtensionAudience({ aud: "expected", expires_in: 0 }, "expected"),
		).toThrow();
	});
	it("checks audience before profile or session creation", async () => {
		const transport = vi.fn(async () =>
			Response.json({ aud: "wrong", expires_in: 60 }),
		);
		await expect(
			verifyGoogleExtensionToken(
				"opaque",
				"expected",
				transport as typeof fetch,
			),
		).rejects.toThrow();
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("returns only verified profile, not the access token", async () => {
		const transport = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({ aud: "expected", expires_in: 60, sub: "google-sub" }),
			)
			.mockResolvedValueOnce(
				Response.json({
					sub: "google-sub",
					email: "user@example.test",
					email_verified: true,
					name: "User",
				}),
			);
		const profile = await verifyGoogleExtensionToken(
			"opaque",
			"expected",
			transport,
		);
		expect(profile.sub).toBe("google-sub");
		expect(JSON.stringify(profile)).not.toContain("opaque");
	});
});
import { invalidateCachePrefix } from "../src/cache";
it("paginates every cache-prefix page", async () => {
	const deleted: string[] = [];
	const list = vi
		.fn()
		.mockResolvedValueOnce({
			keys: [{ name: "news:a" }],
			list_complete: false,
			cursor: "next",
		})
		.mockResolvedValueOnce({ keys: [{ name: "news:b" }], list_complete: true });
	await invalidateCachePrefix(
		{
			list,
			delete: async (key) => {
				deleted.push(key);
			},
		},
		"news:",
	);
	expect(deleted).toEqual(["news:a", "news:b"]);
	expect(list).toHaveBeenLastCalledWith({ prefix: "news:", cursor: "next" });
});
it("normalizes dotted extension lists and supports unrestricted known-safe extensions", () => {
	expect(
		validateUpload({ name: "x.png", type: "image/png", size: 10 }, [".png"], 20)
			.extension,
	).toBe("png");
	expect(
		validateUpload({ name: "x.pdf", type: "application/pdf", size: 10 }, [], 20)
			.extension,
	).toBe("pdf");
});
import { normalizeStorageFolder, decodeFileCursor } from "../src/storage";
it("supports safe configurable folders without path traversal", () => {
	expect(normalizeStorageFolder("userfiles/avatars")).toBe("userfiles/avatars");
	for (const value of [
		"../admin",
		"/root",
		"a//b",
		"a/../b",
		"a\\b",
		"%2e%2e",
		"",
	])
		expect(() => normalizeStorageFolder(value)).toThrow("folder");
});
it("validates bounded file cursors before querying D1", () => {
	const time = Date.now();
	expect(
		decodeFileCursor(btoa(JSON.stringify({ time, id: "file-123" }))),
	).toEqual({ date: new Date(time), id: "file-123" });
	for (const value of [
		"not base64",
		btoa(JSON.stringify({ time: 1e100, id: "a" })),
		btoa(JSON.stringify({ time, id: "" })),
	])
		expect(() => decodeFileCursor(value)).toThrow("cursor");
});
import { createCacheKey } from "../src/cache";
it("composes stable cache keys without ambiguous segment boundaries", () => {
	expect(createCacheKey("newsletter", "member", 1)).toBe("newsletter:member:1");
	expect(createCacheKey("a:b", "c")).not.toBe(createCacheKey("a", "b:c"));
	expect(() => createCacheKey("")).toThrow("namespace");
});
