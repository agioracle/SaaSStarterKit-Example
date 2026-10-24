import { websiteConfig } from "../src/config/website";
import { DEFAULT_AI_POLICY } from "../src/ai/policy";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Bindings } from "../src/env";
import {
	createGeneration,
	refreshGeneration,
	deleteGeneration,
	generationAsset,
} from "../src/generation/service.server";
import { reconcileGeneration } from "../src/generation/reconciliation.server";
import { failJob, markUnknown, ownedJob } from "../src/generation/store.server";
import type { Transport } from "../src/generation/providers.server";
vi.mock("@tanstack/react-start/server-only", () => ({}));
const input = () => ({
	model: "fal-flux-schnell",
	prompt: "local functional fixture",
	aspectRatio: "1:1",
	idempotencyKey: crypto.randomUUID(),
});
const json = (data: unknown) =>
	new Response(JSON.stringify(data), {
		headers: { "Content-Type": "application/json" },
	});
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 4]);
const successfulTransport = (): Transport =>
	vi.fn(async (url: string, init?: RequestInit) => {
		if (init?.method === "POST")
			return json({ request_id: "local-request-fixture" });
		if (url.endsWith("/status")) return json({ status: "COMPLETED" });
		if (url.includes("/requests/"))
			return json({
				has_nsfw_concepts: [false],
				images: [
					{
						url: "https://fal.media/files/local-fixture.jpg",
						width: 1024,
						height: 1024,
					},
				],
			});
		return new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } });
	});
const settle = {
	outcome: "released",
	reason: "Provider history checked and no request is still running.",
	providerInspectionConfirmed: true,
};
describe("Lumina independent job lifecycle and reconciliation regression", () => {
	let mf: Miniflare;
	let db: D1Database;
	let bucket: R2Bucket;
	let env: Bindings;
	beforeAll(async () => {
		mf = new Miniflare(
			convertV4MiniflareOptions({
				modules: true,
				script:
					'export default {fetch(){return new Response("review fixture")}}',
				compatibilityDate: "2026-10-01",
				d1Databases: ["DB"],
				r2Buckets: ["BUCKET"],
			}),
		);
		db = (await mf.getD1Database("DB")) as unknown as D1Database;
		bucket = (await mf.getR2Bucket("BUCKET")) as unknown as R2Bucket;
		for (const filename of (await readdir("drizzle"))
			.filter((name) => name.endsWith(".sql"))
			.sort())
			for (const sql of (await readFile(`drizzle/${filename}`, "utf8"))
				.split("--> statement-breakpoint")
				.map((s) => s.trim())
				.filter(Boolean))
				await db.prepare(sql).run();
	}, 30_000);
	beforeEach(async () => {
		await db
			.prepare("UPDATE generation_jobs SET billing_state='released'")
			.run();
		await db.prepare("DELETE FROM generation_capacity").run();
		await db.prepare("DELETE FROM user").run();
		await db.prepare("DELETE FROM account_deletions").run();
		for (const id of ["owner", "other", "admin"])
			await db
				.prepare(
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
		const objects = await bucket.list();
		for (const object of objects.objects) await bucket.delete(object.key);
		env = {
			DB: db,
			BUCKET: bucket,
			IMAGE_GENERATION_ENABLED: "true",
			FAL_API_KEY: "fixture-local-no-network",
		} as unknown as Bindings;
	});
	afterAll(async () => {
		await mf?.dispose();
	}, 30_000);
	it("settles concurrent polls once and only downloads one output", async () => {
		const transport = successfulTransport();
		const created = await createGeneration(env, "owner", input(), transport);
		const results = await Promise.all(
			Array.from({ length: 10 }, () =>
				refreshGeneration(env, "owner", created.job.id, transport),
			),
		);
		const row = await ownedJob(db, "owner", created.job.id);
		expect(row).toMatchObject({
			status: "succeeded",
			billing_state: "charged",
		});
		expect(results.some((result) => result.usage.used === 1)).toBe(true);
		expect(
			vi
				.mocked(transport)
				.mock.calls.filter(([url]) => url.startsWith("https://fal.media/")),
		).toHaveLength(1);
		expect((await bucket.list()).objects).toHaveLength(1);
	});
	it("rejects cross-account asset and delete and preserves charge after owned deletion", async () => {
		const transport = successfulTransport();
		const created = await createGeneration(env, "owner", input(), transport);
		await refreshGeneration(env, "owner", created.job.id, transport);
		await expect(
			generationAsset(env, "other", created.job.id),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			deleteGeneration(env, "other", created.job.id),
		).rejects.toMatchObject({ status: 404 });
		const asset = await generationAsset(env, "owner", created.job.id, true);
		expect(asset.headers.get("content-disposition")).toContain("attachment");
		expect(new Uint8Array(await asset.arrayBuffer())).toEqual(jpeg);
		await deleteGeneration(env, "owner", created.job.id);
		expect(await ownedJob(db, "owner", created.job.id)).toMatchObject({
			status: "deleted",
			billing_state: "charged",
			prompt: "",
		});
		expect((await bucket.list()).objects).toHaveLength(0);
		await expect(
			generationAsset(env, "owner", created.job.id),
		).rejects.toMatchObject({ status: 404 });
	});
	it("keeps a recoverable tombstone after R2 deletion failure and makes retry idempotent", async () => {
		const transport = successfulTransport();
		const created = await createGeneration(env, "owner", input(), transport);
		await refreshGeneration(env, "owner", created.job.id, transport);
		const failed = {
			...env,
			BUCKET: {
				delete: async () => {
					throw Error("fixture deletion failed");
				},
			},
		} as unknown as Bindings;
		await expect(
			deleteGeneration(failed, "owner", created.job.id),
		).rejects.toThrow();
		expect(await ownedJob(db, "owner", created.job.id)).toMatchObject({
			status: "deleting",
			billing_state: "charged",
		});
		expect(await deleteGeneration(env, "owner", created.job.id)).toEqual({
			deleted: true,
		});
		expect(await deleteGeneration(env, "owner", created.job.id)).toEqual({
			deleted: true,
		});
	});
	it("recovers duplicate create despite provider being disabled, without new inference", async () => {
		const transport = successfulTransport();
		const request = input();
		const created = await createGeneration(env, "owner", request, transport);
		const replay = await createGeneration(
			{ ...env, IMAGE_GENERATION_ENABLED: "false" },
			"owner",
			request,
			transport,
		);
		expect(replay.job.id).toBe(created.job.id);
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("preserves reservation after completed inference but failed CDN retrieval", async () => {
		const created = await createGeneration(
			env,
			"owner",
			input(),
			successfulTransport(),
		);
		const transport: Transport = vi.fn(async (url: string) =>
			url.endsWith("/status")
				? json({ status: "COMPLETED" })
				: url.includes("/requests/")
					? json({
							has_nsfw_concepts: [false],
							images: [{ url: "https://fal.media/files/expired.jpg" }],
						})
					: new Response("expired", { status: 403 }),
		);
		const result = await refreshGeneration(
			env,
			"owner",
			created.job.id,
			transport,
		);
		expect(result).toMatchObject({
			job: { status: "unknown", canRefresh: true },
			usage: { used: 0, reserved: 1 },
		});
	});
	it("fences obsolete poll outcomes at the final atomic mutation", async () => {
		const created = await createGeneration(
			env,
			"owner",
			input(),
			successfulTransport(),
		);
		const stale = await ownedJob(db, "owner", created.job.id);
		await db
			.prepare(
				"UPDATE generation_jobs SET poll_token='new-current-poll' WHERE id=?",
			)
			.bind(created.job.id)
			.run();
		await failJob(db, stale, "provider_failed", "old-poll");
		await markUnknown(db, stale, "result_pending", "old-poll");
		expect(await ownedJob(db, "owner", created.job.id)).toMatchObject({
			status: "queued",
			billing_state: "reserved",
			poll_token: "new-current-poll",
		});
	});
	it("requires administrator and quarantine for manual reconciliation", async () => {
		const created = await createGeneration(
			env,
			"owner",
			input(),
			successfulTransport(),
		);
		await expect(
			reconcileGeneration(env, "owner", created.job.id, settle),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			reconcileGeneration(env, "admin", created.job.id, settle),
		).rejects.toMatchObject({ status: 409 });
		await db
			.prepare(
				"UPDATE generation_jobs SET updated_at=?,status='unknown',poll_after=0 WHERE id=?",
			)
			.bind(Date.now() - 300001, created.job.id)
			.run();
		const results = await Promise.allSettled(
			Array.from({ length: 6 }, () =>
				reconcileGeneration(env, "admin", created.job.id, settle),
			),
		);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(await ownedJob(db, "owner", created.job.id)).toMatchObject({
			status: "failed",
			billing_state: "released",
		});
		expect(
			await db
				.prepare(
					"SELECT count(*) AS count FROM generation_reconciliations WHERE job_id=?",
				)
				.bind(created.job.id)
				.first<number>("count"),
		).toBe(1);
	});
	it("never manually settles a possibly incomplete R2 write even after its poll lease expires", async () => {
		const created = await createGeneration(
			env,
			"owner",
			input(),
			successfulTransport(),
		);
		await db
			.prepare(
				"UPDATE generation_jobs SET updated_at=?,status='unknown',poll_after=0,poll_token='save:inflight-fixture' WHERE id=?",
			)
			.bind(Date.now() - 300001, created.job.id)
			.run();
		await expect(
			reconcileGeneration(env, "admin", created.job.id, settle),
		).rejects.toMatchObject({ status: 409 });
		expect(await ownedJob(db, "owner", created.job.id)).toMatchObject({
			billing_state: "reserved",
			poll_token: "save:inflight-fixture",
		});
	});
	it("charges completed safety-blocked inference without exposing or downloading its output", async () => {
		const created = await createGeneration(
			env,
			"owner",
			input(),
			successfulTransport(),
		);
		const transport: Transport = vi.fn(async (url: string) =>
			url.endsWith("/status")
				? json({ status: "COMPLETED" })
				: json({ has_nsfw_concepts: [true], images: [] }),
		);
		const result = await refreshGeneration(
			env,
			"owner",
			created.job.id,
			transport,
		);
		expect(result).toMatchObject({
			job: { status: "failed", assetUrl: null, canDelete: true },
			usage: { used: 1, reserved: 0 },
		});
		expect(await ownedJob(db, "owner", created.job.id)).toMatchObject({
			billing_state: "charged",
			error_code: "safety_blocked",
		});
		expect(transport).toHaveBeenCalledTimes(2);
		expect((await bucket.list()).objects).toHaveLength(0);
	});
	it("recovers an already-stored asset after a failed D1 finalization without repeating provider work", async () => {
		const transport = successfulTransport();
		const created = await createGeneration(env, "owner", input(), transport);
		let rejected = false;
		const flakyDb = {
			batch: db.batch.bind(db),
			prepare(sql: string) {
				const prepared = db.prepare(sql);
				if (!sql.includes("SET status='succeeded'")) return prepared;
				return {
					bind(...args: unknown[]) {
						const bound = prepared.bind(...args);
						return {
							run: async () => {
								if (!rejected) {
									rejected = true;
									throw Error("fixture lost D1 finalize");
								}
								return bound.run();
							},
						};
					},
				};
			},
		} as unknown as D1Database;
		const interrupted = await refreshGeneration(
			{ ...env, DB: flakyDb },
			"owner",
			created.job.id,
			transport,
		);
		expect(interrupted.usage).toMatchObject({ used: 0, reserved: 1 });
		expect((await ownedJob(db, "owner", created.job.id)).poll_token).toMatch(
			/^save:/,
		);
		expect((await bucket.list()).objects).toHaveLength(1);
		const noNetwork: Transport = vi.fn(async () => {
			throw Error("Recovery must not call provider");
		});
		const recovered = await refreshGeneration(
			env,
			"owner",
			created.job.id,
			noNetwork,
		);
		expect(recovered).toMatchObject({
			job: { status: "succeeded" },
			usage: { used: 1, reserved: 0 },
		});
		expect(noNetwork).not.toHaveBeenCalled();
	});
});

Object.assign(websiteConfig.ai, {
	...DEFAULT_AI_POLICY,
	enabled: true,
	userConcurrent: 2,
});
