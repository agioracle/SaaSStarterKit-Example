import { websiteConfig } from "../src/config/website";
import { DEFAULT_AI_POLICY } from "../src/ai/policy";
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
import type { Bindings } from "../src/env";
import {
	createGeneration,
	refreshGeneration,
	generationAsset,
	deleteGeneration,
	generationConfig,
	listGenerations,
} from "../src/generation/service.server";
import { ownedJob } from "../src/generation/store.server";
import {
	listUnresolvedGenerations,
	reconcileGeneration,
} from "../src/generation/reconciliation.server";
import type { GenerationInput } from "../src/generation/types";
vi.mock("@tanstack/react-start/server-only", () => ({}));
const jpg = new Uint8Array([
	255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 255, 217,
]);
const input = (
	model: GenerationInput["model"] = "fal-flux-schnell",
): GenerationInput => ({
	model,
	prompt: "Local fixture mountain",
	aspectRatio: "1:1",
	idempotencyKey: crypto.randomUUID(),
});
const falTransport = async (url: string, init?: RequestInit) => {
	if (init?.method === "POST")
		return Response.json({ request_id: crypto.randomUUID() });
	if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" });
	if (url.startsWith("https://queue.fal.run/"))
		return Response.json({
			has_nsfw_concepts: [false],
			images: [
				{
					url: "https://v3.fal.media/local.jpg",
					width: 1024,
					height: 1024,
					content_type: "image/jpeg",
				},
			],
		});
	if (url === "https://v3.fal.media/local.jpg")
		return new Response(jpg, { headers: { "content-type": "image/jpeg" } });
	throw Error("Unexpected network target");
};
describe("generation durable state with real local D1 and R2", () => {
	let mf: Miniflare;
	let env: Bindings;
	beforeAll(async () => {
		mf = new Miniflare(
			convertV4MiniflareOptions({
				modules: true,
				script: 'export default {fetch(){return new Response("fixture")}}',
				compatibilityDate: "2026-10-01",
				d1Databases: ["DB"],
				r2Buckets: ["BUCKET"],
			}),
		);
		const DB = (await mf.getD1Database("DB")) as unknown as D1Database;
		for (const name of (await readdir("drizzle"))
			.filter((n) => n.endsWith(".sql"))
			.sort())
			for (const sql of (await readFile(`drizzle/${name}`, "utf8"))
				.split("--> statement-breakpoint")
				.map((s) => s.trim())
				.filter(Boolean))
				await DB.prepare(sql).run();
		env = {
			DB,
			BUCKET: await mf.getR2Bucket("BUCKET"),
			IMAGE_GENERATION_ENABLED: "true",
			FAL_API_KEY: "local-fixture-fal-token",
			CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
			CLOUDFLARE_AI_API_TOKEN: "local-fixture-cf-token",
		} as unknown as Bindings;
		for (const id of ["owner", "other", "admin"])
			await DB.prepare(
				"INSERT INTO user(id,name,email,email_verified,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
			)
				.bind(
					id,
					id,
					`${id}@example.test`,
					1,
					id === "admin" ? "admin" : "user",
					Date.now(),
					Date.now(),
				)
				.run();
	});
	beforeEach(async () => {
		await env.DB.prepare(
			"UPDATE generation_jobs SET billing_state='released'",
		).run();
		await env.DB.prepare("DELETE FROM generation_jobs").run();
		await env.DB.prepare("DELETE FROM generation_capacity").run();
		await env.DB.prepare("DELETE FROM account_deletions").run();
		delete env.IMAGE_FREE_MONTHLY_LIMIT;
		delete env.IMAGE_FREE_RETAINED_LIMIT;
		delete env.IMAGE_MAX_CONCURRENT;
	});
	afterAll(async () => {
		await mf?.dispose();
	});
	it("returns disabled provider information without spending quota", async () => {
		const disabled = {
			...env,
			FAL_API_KEY: undefined,
			CLOUDFLARE_AI_API_TOKEN: undefined,
		};
		const transport = vi.fn(falTransport);
		expect((await generationConfig(disabled, "owner")).available).toBe(false);
		await expect(
			createGeneration(disabled, "owner", input(), transport),
		).rejects.toMatchObject({ status: 503 });
		expect(transport).not.toHaveBeenCalled();
		expect((await generationConfig(env, "owner")).usage.active).toBe(0);
	});
	it("deduplicates simultaneous POSTs and enforces input-hash conflicts", async () => {
		const body = input();
		const transport = vi.fn(falTransport);
		const [a, b] = await Promise.all([
			createGeneration(env, "owner", body, transport),
			createGeneration(env, "owner", body, transport),
		]);
		expect(a.job.id).toBe(b.job.id);
		expect(transport).toHaveBeenCalledTimes(1);
		await expect(
			createGeneration(env, "owner", { ...body, prompt: "Changed" }, transport),
		).rejects.toMatchObject({ status: 409 });
		const recovered = await createGeneration(
			{ ...env, FAL_API_KEY: undefined },
			"owner",
			body,
			transport,
		);
		expect(recovered.job.id).toBe(a.job.id);
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("reserves and charges one credit only after private R2 persist; owns download/delete/reuse", async () => {
		const body = input();
		const transport = vi.fn(falTransport);
		const created = await createGeneration(env, "owner", body, transport);
		expect(created.job.status).toBe("queued");
		expect(created.usage.reserved).toBe(1);
		const finished = await refreshGeneration(
			env,
			"owner",
			created.job.id,
			transport,
		);
		expect(finished.job.status).toBe("succeeded");
		expect(finished.usage).toMatchObject({ used: 1, reserved: 0, active: 0 });
		const download = await generationAsset(env, "owner", created.job.id, true);
		expect(new Uint8Array(await download.arrayBuffer())).toEqual(jpg);
		expect(download.headers.get("cache-control")).toContain("no-store");
		expect(download.headers.get("content-disposition")).toContain("attachment");
		await expect(
			generationAsset(env, "other", created.job.id),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			deleteGeneration(env, "other", created.job.id),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			refreshGeneration(env, "other", created.job.id, transport),
		).rejects.toMatchObject({ status: 404 });
		const row = await ownedJob(env.DB, "owner", created.job.id);
		expect(await env.BUCKET.head(row.object_key)).not.toBeNull();
		await deleteGeneration(env, "owner", created.job.id);
		expect(await env.BUCKET.head(row.object_key)).toBeNull();
		expect((await generationConfig(env, "owner")).usage.used).toBe(1);
		expect(
			(await listGenerations(env, "owner", new URLSearchParams())).jobs,
		).toHaveLength(0);
		const replay = await createGeneration(env, "owner", body, transport);
		expect(replay.job.status).toBe("deleted");
		expect(replay.job.prompt).toBe("");
		expect(
			transport.mock.calls.filter((c) => c[1]?.method === "POST"),
		).toHaveLength(1);
	});
	it("persists synchronous Workers output without any queue retry", async () => {
		const transport = vi.fn(async () =>
			Response.json({
				success: true,
				result: { image: Buffer.from(jpg).toString("base64") },
			}),
		);
		const result = await createGeneration(
			env,
			"owner",
			input("workers-flux-schnell"),
			transport,
		);
		expect(result.job.status).toBe("succeeded");
		expect(result.usage.used).toBe(1);
		expect(transport).toHaveBeenCalledTimes(1);
		expect(
			new Uint8Array(
				await (
					await generationAsset(env, "owner", result.job.id)
				).arrayBuffer(),
			),
		).toEqual(jpg);
	});
	it("does not retry or release ambiguous dispatches", async () => {
		const transport = vi.fn(async () => {
			throw Error("timeout");
		});
		const body = input();
		const first = await createGeneration(env, "owner", body, transport);
		expect(first.job.status).toBe("unknown");
		expect(first.usage).toMatchObject({ reserved: 1, used: 0, active: 1 });
		expect(first.job.canRefresh).toBe(false);
		await createGeneration(env, "owner", body, transport);
		await refreshGeneration(env, "owner", first.job.id, transport);
		expect(transport).toHaveBeenCalledTimes(1);
		await expect(
			deleteGeneration(env, "owner", first.job.id),
		).rejects.toMatchObject({ status: 409 });
	});
	it("atomically caps concurrent unique requests", async () => {
		const transport = vi.fn(falTransport);
		const results = await Promise.allSettled(
			Array.from({ length: 8 }, () =>
				createGeneration(env, "owner", input(), transport),
			),
		);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
		expect(transport).toHaveBeenCalledTimes(2);
		expect((await generationConfig(env, "owner")).usage.active).toBe(2);
	});
	it("enforces monthly quota even after images are deleted", async () => {
		env.IMAGE_FREE_MONTHLY_LIMIT = "1";
		const first = await createGeneration(env, "owner", input(), falTransport);
		await refreshGeneration(env, "owner", first.job.id, falTransport);
		await deleteGeneration(env, "owner", first.job.id);
		const transport = vi.fn(falTransport);
		await expect(
			createGeneration(env, "owner", input(), transport),
		).rejects.toMatchObject({ status: 429 });
		expect(transport).not.toHaveBeenCalled();
	});
	it("enforces retained cap separately from active and month quotas", async () => {
		env.IMAGE_FREE_RETAINED_LIMIT = "1";
		const first = await createGeneration(env, "owner", input(), falTransport);
		await refreshGeneration(env, "owner", first.job.id, falTransport);
		await expect(
			createGeneration(env, "owner", input(), falTransport),
		).rejects.toMatchObject({ status: 409 });
		await deleteGeneration(env, "owner", first.job.id);
		expect(
			(await createGeneration(env, "owner", input(), falTransport)).job.status,
		).toBe("queued");
	});
	it("fences account deletion before reserving or calling inference", async () => {
		await env.DB.prepare(
			"INSERT INTO account_deletions(user_id,created_at) VALUES(?,?)",
		)
			.bind("owner", Date.now())
			.run();
		const transport = vi.fn(falTransport);
		await expect(
			createGeneration(env, "owner", input(), transport),
		).rejects.toMatchObject({ status: 409 });
		expect(transport).not.toHaveBeenCalled();
	});
	it("releases only confirmed failures and never remote status/download errors", async () => {
		const first = await createGeneration(env, "owner", input(), falTransport);
		const failed = await refreshGeneration(
			env,
			"owner",
			first.job.id,
			async () =>
				Response.json({
					status: "COMPLETED",
					error: "Provider rejected image",
					error_type: "validation",
				}),
		);
		expect(failed.job.status).toBe("failed");
		expect(failed.usage.reserved).toBe(0);
		const second = await createGeneration(env, "owner", input(), falTransport);
		const uncertain = await refreshGeneration(
			env,
			"owner",
			second.job.id,
			async () => new Response("gone", { status: 403 }),
		);
		expect(uncertain.job.status).toBe("unknown");
		expect(uncertain.usage.reserved).toBe(1);
	});
	it("recovers an R2 write persisted before the final D1 checkpoint without another inference or write", async () => {
		const body = input("workers-flux-schnell");
		let putCount = 0;
		const realBucket = env.BUCKET;
		const interrupted = {
			...env,
			BUCKET: {
				put: async (...args: Parameters<R2Bucket["put"]>) => {
					putCount++;
					await realBucket.put(...args);
					throw Error("Lost R2 acknowledgment");
				},
				head: (...args: Parameters<R2Bucket["head"]>) =>
					realBucket.head(...args),
			},
		} as unknown as Bindings;
		const transport = vi.fn(async () =>
			Response.json({
				success: true,
				result: { image: Buffer.from(jpg).toString("base64") },
			}),
		);
		const created = await createGeneration(
			interrupted,
			"owner",
			body,
			transport,
		);
		expect(created.job.status).toBe("unknown");
		expect(
			(await ownedJob(env.DB, "owner", created.job.id)).poll_token,
		).toMatch(/^save:/);
		const recovered = await refreshGeneration(
			env,
			"owner",
			created.job.id,
			transport,
		);
		expect(recovered.job.status).toBe("succeeded");
		expect(recovered.usage.used).toBe(1);
		expect(transport).toHaveBeenCalledTimes(1);
		expect(putCount).toBe(1);
	});
	it("never reclaims a missing-object storage write lock or settles it online", async () => {
		const body = input("workers-flux-schnell");
		const blocked = {
			...env,
			BUCKET: {
				put: async () => {
					throw Error("Uncertain R2 write");
				},
			},
		} as unknown as Bindings;
		const transport = vi.fn(async () =>
			Response.json({
				success: true,
				result: { image: Buffer.from(jpg).toString("base64") },
			}),
		);
		const created = await createGeneration(blocked, "owner", body, transport);
		const refreshed = await refreshGeneration(
			env,
			"owner",
			created.job.id,
			transport,
		);
		expect(refreshed.job.status).toBe("unknown");
		expect(refreshed.usage.reserved).toBe(1);
		expect(transport).toHaveBeenCalledTimes(1);
		await env.DB.prepare(
			"UPDATE generation_jobs SET updated_at=?,poll_after=0 WHERE id=?",
		)
			.bind(Date.now() - 600000, created.job.id)
			.run();
		await expect(
			reconcileGeneration(env, "admin", created.job.id, {
				outcome: "released",
				reason: "Inspected provider but storage write remains uncertain.",
				providerInspectionConfirmed: true,
			}),
		).rejects.toMatchObject({ status: 409 });
	});
	it("manually reconciles only stale requests with admin inspection and durable audit", async () => {
		const result = await createGeneration(env, "owner", input(), async () => {
			throw Error("uncertain");
		});
		const body = {
			outcome: "released",
			reason:
				"Inspected provider request history and confirmed no dispatch exists.",
			providerInspectionConfirmed: true,
		};
		await expect(
			reconcileGeneration(env, "owner", result.job.id, body),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			reconcileGeneration(env, "admin", result.job.id, body),
		).rejects.toMatchObject({ status: 409 });
		await env.DB.prepare("UPDATE generation_jobs SET updated_at=? WHERE id=?")
			.bind(Date.now() - 600000, result.job.id)
			.run();
		expect((await listUnresolvedGenerations(env, "admin")).jobs).toHaveLength(
			1,
		);
		const settled = await reconcileGeneration(
			env,
			"admin",
			result.job.id,
			body,
		);
		expect(settled.job.status).toBe("failed");
		expect((await generationConfig(env, "owner")).usage.reserved).toBe(0);
		expect(
			await env.DB.prepare(
				"SELECT COUNT(*) AS n FROM generation_reconciliations",
			).first<number>("n"),
		).toBe(1);
		await expect(
			reconcileGeneration(env, "admin", result.job.id, body),
		).rejects.toMatchObject({ status: 409 });
	});
});

Object.assign(websiteConfig.ai, {
	...DEFAULT_AI_POLICY,
	enabled: true,
	userConcurrent: 2,
});
