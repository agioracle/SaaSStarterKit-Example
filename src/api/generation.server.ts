import { z } from "zod";
import type { Bindings } from "../env";
import { publicEnvironment } from "../env";
import { assertSameOrigin, HttpError, json, readJson } from "../lib/security";
import {
	createGeneration,
	deleteGeneration,
	generationAsset,
	generationConfig,
	listGenerations,
	refreshGeneration,
} from "../generation/service.server";
import {
	ownedJob,
	publicJob,
	recoverStaleDispatch,
	requireGenerationSchema,
} from "../generation/store.server";
import { rateLimit } from "./rate-limit.server";
export async function handleGenerations(
	request: Request,
	env: Bindings,
	userId: string,
) {
	const url = new URL(request.url);
	const path = url.pathname;
	if (!["GET", "HEAD", "OPTIONS"].includes(request.method))
		assertSameOrigin(request, publicEnvironment(env).APP_URL);
	if (path === "/api/generations/config" && request.method === "GET")
		return json(await generationConfig(env, userId));
	if (path === "/api/generations") {
		if (request.method === "GET")
			return json(await listGenerations(env, userId, url.searchParams));
		if (request.method === "POST") {
			await rateLimit(env.DB, `generation:create:${userId}`, 20, 60);
			return json(
				await createGeneration(env, userId, await readJson(request, 12_000)),
				202,
			);
		}
		throw new HttpError(405, "Method not allowed.");
	}
	const match = /^\/api\/generations\/([^/]+)(?:\/(refresh|asset))?$/.exec(
		path,
	);
	if (!match) throw new HttpError(404, "Endpoint not found.");
	const id = z.uuid().parse(match[1]);
	const action = match[2];
	await requireGenerationSchema(env.DB);
	if (action === "asset" && request.method === "GET")
		return generationAsset(
			env,
			userId,
			id,
			url.searchParams.get("download") === "1",
		);
	if (action === "refresh" && request.method === "POST") {
		await rateLimit(env.DB, `generation:refresh:${userId}`, 60, 60);
		return json(await refreshGeneration(env, userId, id));
	}
	if (!action && request.method === "DELETE")
		return json(await deleteGeneration(env, userId, id));
	if (!action && request.method === "GET") {
		await recoverStaleDispatch(env.DB, userId);
		return json({ job: publicJob(await ownedJob(env.DB, userId, id)) });
	}
	throw new HttpError(405, "Method not allowed.");
}
