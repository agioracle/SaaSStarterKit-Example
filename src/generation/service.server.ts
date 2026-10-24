import "@tanstack/react-start/server-only";
import type { Bindings } from "../env";
import { HttpError } from "../lib/security";
import { generationInputSchema } from "./validation";
import { generationPolicy, modelCatalog, requireModel } from "./policy.server";
import {
	existingRequest,
	failJob,
	markUnknown,
	ownedJob,
	publicJob,
	recoverStaleDispatch,
	requestHash,
	requireGenerationSchema,
	reserveJob,
	usage,
	type JobRow,
} from "./store.server";
import {
	generateWorkers,
	GenerationProviderError,
	MAX_IMAGE_BYTES,
	pollFal,
	submitFal,
	type ImageOutput,
	type Transport,
} from "./providers.server";
import type {
	GenerationConfig,
	GenerationResult,
	GenerationList,
} from "./types";

async function currentResult(
	env: Bindings,
	userId: string,
	id: string,
): Promise<GenerationResult> {
	const policy = await generationPolicy(env, userId);
	return {
		job: publicJob(await ownedJob(env.DB, userId, id)),
		usage: await usage(env.DB, userId, policy),
	};
}
export async function generationConfig(
	env: Bindings,
	userId: string,
): Promise<GenerationConfig> {
	await requireGenerationSchema(env.DB);
	await recoverStaleDispatch(env.DB, userId);
	const models = modelCatalog(env);
	return {
		models,
		usage: await usage(env.DB, userId, await generationPolicy(env, userId)),
		available: models.some((m) => m.available),
		unavailableReason: models.some((m) => m.available)
			? null
			: models[0].unavailableReason,
	};
}
async function finalizeStored(
	env: Bindings,
	row: JobRow,
	token: string | null,
) {
	const object = await env.BUCKET.head(row.object_key);
	if (!object) return false;
	const metadata = object.customMetadata;
	if (
		metadata?.generationId !== row.id ||
		metadata?.owner !== row.user_id ||
		object.size <= 0 ||
		object.size > MAX_IMAGE_BYTES ||
		!["image/jpeg", "image/png"].includes(
			object.httpMetadata?.contentType || "",
		)
	)
		throw new GenerationProviderError(false, "result_pending");
	const dimension = (value: string | undefined) =>
		value && /^\d+$/.test(value) && Number(value) <= 4096
			? Number(value)
			: null;
	const result =
		await env.DB.prepare(`UPDATE generation_jobs SET status='succeeded',billing_state='charged',content_type=?,byte_size=?,width=?,height=?,error_code=NULL,poll_token=NULL,updated_at=?
    WHERE id=? AND billing_state='reserved' AND poll_token IS ?`)
			.bind(
				object.httpMetadata?.contentType,
				object.size,
				dimension(metadata.width),
				dimension(metadata.height),
				Date.now(),
				row.id,
				token,
			)
			.run();
	return result.meta.changes > 0;
}
async function saveImage(
	env: Bindings,
	row: JobRow,
	image: ImageOutput,
	token: string | null,
) {
	// A durable write lock is never lease-reclaimed. Recovery may finalize an already
	// stored object, but cannot start a second R2 write while the first is uncertain.
	const saveToken = `save:${token || crypto.randomUUID()}`;
	const lock = await env.DB.prepare(
		"UPDATE generation_jobs SET poll_token=?,poll_after=? WHERE id=? AND billing_state='reserved' AND poll_token IS ?",
	)
		.bind(saveToken, Date.now() + 120000, row.id, token)
		.run();
	if (!lock.meta.changes) return;
	try {
		await env.BUCKET.put(row.object_key, image.bytes, {
			onlyIf: { etagDoesNotMatch: "*" },
			httpMetadata: {
				contentType: image.contentType,
				cacheControl: "private, no-store",
			},
			customMetadata: {
				generationId: row.id,
				owner: row.user_id,
				width: String(image.width ?? ""),
				height: String(image.height ?? ""),
			},
		});
		const finished = await finalizeStored(env, row, saveToken);
		if (!finished) {
			const current = await env.DB.prepare(
				"SELECT status,billing_state FROM generation_jobs WHERE id=?",
			)
				.bind(row.id)
				.first<{ status: string; billing_state: string }>();
			// The stable object key is also retained in tombstones/account-deletion manifests.
			if (
				!current ||
				(current.billing_state !== "reserved" && current.status !== "succeeded")
			)
				await env.BUCKET.delete(row.object_key);
		}
	} catch (error) {
		await markUnknown(env.DB, row, "result_pending", saveToken);
		throw error;
	}
}
export async function createGeneration(
	env: Bindings,
	userId: string,
	body: unknown,
	transport: Transport = fetch,
): Promise<GenerationResult> {
	const input = generationInputSchema.parse(body);
	await requireGenerationSchema(env.DB);
	const hash = await requestHash(input);
	// Idempotency recovery must work even if provider configuration/quota changes later.
	const existing = await existingRequest(env.DB, userId, input, hash);
	if (existing) return currentResult(env, userId, existing.id);
	requireModel(env, input.model);
	const policy = await generationPolicy(env, userId);
	const { row, created } = await reserveJob(
		env.DB,
		userId,
		input,
		hash,
		policy,
	);
	if (!created) return currentResult(env, userId, row.id);
	try {
		if (row.provider === "fal") {
			const requestId = await submitFal(env, input, transport);
			// This ID is the only recovery handle. No code path re-submits this row.
			await env.DB.prepare(
				"UPDATE generation_jobs SET provider_request_id=?,status='queued',updated_at=? WHERE id=? AND billing_state='reserved'",
			)
				.bind(requestId, Date.now(), row.id)
				.run();
		} else {
			await saveImage(
				env,
				row,
				await generateWorkers(env, input, transport),
				null,
			);
		}
	} catch (error) {
		if (error instanceof GenerationProviderError && error.definitive)
			await failJob(env.DB, row, error.code);
		// Storage-write failures mark their own save token in saveImage. A create
		// response must never overwrite a newer independently claimed poll outcome.
		else await markUnknown(env.DB, row);
	}
	return currentResult(env, userId, row.id);
}
export async function refreshGeneration(
	env: Bindings,
	userId: string,
	id: string,
	transport: Transport = fetch,
): Promise<GenerationResult> {
	await requireGenerationSchema(env.DB);
	await recoverStaleDispatch(env.DB, userId);
	let row = await ownedJob(env.DB, userId, id);
	if (row.billing_state !== "reserved" || row.status === "dispatching")
		return currentResult(env, userId, id);
	if (row.provider === "fal" && !row.provider_request_id)
		return currentResult(env, userId, id);
	if (row.poll_token?.startsWith("save:")) {
		// This is a safe R2 HEAD recovery, not another write or inference call.
		try {
			await finalizeStored(env, row, row.poll_token);
		} catch {
			await markUnknown(env.DB, row, "result_pending", row.poll_token);
		}
		return currentResult(env, userId, id);
	}
	const now = Date.now();
	const token = crypto.randomUUID();
	const claim = await env.DB.prepare(
		"UPDATE generation_jobs SET poll_token=?,poll_after=? WHERE id=? AND user_id=? AND billing_state='reserved' AND poll_after<=? AND (poll_token IS NULL OR poll_token NOT LIKE 'save:%')",
	)
		.bind(token, now + 120000, id, userId, now)
		.run();
	if (!claim.meta.changes) return currentResult(env, userId, id);
	row = { ...row, poll_token: token };
	try {
		if (await finalizeStored(env, row, token))
			return currentResult(env, userId, id);
		if (row.provider === "cloudflare") {
			await markUnknown(env.DB, row, "dispatch_uncertain", token);
		} else {
			requireModel(env, row.model);
			const result = await pollFal(
				env,
				row.provider_request_id as string,
				transport,
			);
			if (result.status === "succeeded")
				await saveImage(env, row, result.image, token);
			else
				await env.DB.prepare(
					"UPDATE generation_jobs SET status=?,error_code=NULL,updated_at=? WHERE id=? AND billing_state='reserved' AND poll_token=?",
				)
					.bind(result.status, Date.now(), id, token)
					.run();
		}
	} catch (error) {
		// A claim token fences stale poll workers from settling another worker's request.
		const latest = await ownedJob(env.DB, userId, id);
		if (latest.poll_token === token) {
			if (error instanceof GenerationProviderError && error.definitive)
				await failJob(env.DB, row, error.code, token);
			else await markUnknown(env.DB, row, "result_pending", token);
		}
	} finally {
		await env.DB.prepare(
			"UPDATE generation_jobs SET poll_token=NULL,poll_after=? WHERE id=? AND poll_token=?",
		)
			.bind(Date.now() + 3000, id, token)
			.run();
	}
	return currentResult(env, userId, id);
}
export async function listGenerations(
	env: Bindings,
	userId: string,
	params: URLSearchParams,
): Promise<GenerationList> {
	await requireGenerationSchema(env.DB);
	await recoverStaleDispatch(env.DB, userId);
	const rawLimit = params.get("limit") || "24";
	if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)
		throw new HttpError(400, "Invalid image page size.");
	const limit = Number(rawLimit);
	const cursor = params.get("cursor");
	let time = Number.MAX_SAFE_INTEGER;
	let id = "~";
	if (cursor) {
		try {
			const value = JSON.parse(atob(cursor));
			if (
				cursor.length > 256 ||
				!Number.isSafeInteger(value.time) ||
				value.time < 0 ||
				typeof value.id !== "string" ||
				!/^[a-zA-Z0-9-]{1,128}$/.test(value.id)
			)
				throw Error();
			time = value.time;
			id = value.id;
		} catch {
			throw new HttpError(400, "Invalid image cursor.");
		}
	}
	const result = await env.DB.prepare(
		"SELECT * FROM generation_jobs WHERE user_id=? AND status!='deleted' AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?",
	)
		.bind(userId, time, time, id, limit + 1)
		.all<JobRow>();
	const rows = result.results.slice(0, limit);
	const last = rows.at(-1);
	return {
		jobs: rows.map(publicJob),
		nextCursor:
			result.results.length > limit && last
				? btoa(JSON.stringify({ time: last.created_at, id: last.id }))
				: null,
	};
}
export async function deleteGeneration(
	env: Bindings,
	userId: string,
	id: string,
) {
	let row = await ownedJob(env.DB, userId, id);
	if (row.billing_state === "reserved")
		throw new HttpError(
			409,
			"An active or uncertain generation cannot be deleted. Recover it or contact support first.",
		);
	if (!env.BUCKET)
		throw new HttpError(
			503,
			"Image storage is unavailable. Ask the site owner to restore the private R2 binding.",
		);
	if (row.status !== "deleted") {
		await env.DB.prepare(
			"UPDATE generation_jobs SET status='deleting',updated_at=? WHERE id=? AND user_id=? AND billing_state!='reserved' AND status!='deleted'",
		)
			.bind(Date.now(), id, userId)
			.run();
		row = await ownedJob(env.DB, userId, id);
	}
	// Tombstones keep object keys so interrupted deletion is safely retryable.
	await env.BUCKET.delete(row.object_key);
	await env.DB.prepare(
		"UPDATE generation_jobs SET status='deleted',prompt='',seed=NULL,width=NULL,height=NULL,byte_size=NULL,content_type=NULL,error_code=NULL,provider_request_id=NULL,updated_at=? WHERE id=? AND user_id=? AND status='deleting'",
	)
		.bind(Date.now(), id, userId)
		.run();
	return { deleted: true };
}
export async function generationAsset(
	env: Bindings,
	userId: string,
	id: string,
	download = false,
) {
	const row = await ownedJob(env.DB, userId, id);
	if (row.status !== "succeeded" || !row.content_type)
		throw new HttpError(404, "Image not available.");
	const object = await env.BUCKET.get(row.object_key);
	if (!object) throw new HttpError(404, "Image not available.");
	const extension = row.content_type === "image/png" ? "png" : "jpg";
	return new Response(object.body, {
		headers: {
			"content-type": row.content_type,
			"content-length": String(object.size),
			"cache-control": "private, no-store, max-age=0",
			"x-content-type-options": "nosniff",
			"content-security-policy": "default-src 'none'; sandbox",
			"content-disposition": `${download ? "attachment" : "inline"}; filename="lumina-${row.id}.${extension}"`,
		},
	});
}
