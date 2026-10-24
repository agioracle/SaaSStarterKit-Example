import { z } from "zod";
import { downloadContentType } from "../storage";
import type { Bindings } from "../env";
import { websiteConfig } from "../config/website";
import {
	uploadFile,
	listFiles,
	downloadFile,
	getFileInfo,
	deleteFile,
} from "../storage/index.server";
import { HttpError, json, readJson } from "../lib/security";
export async function handleFiles(
	request: Request,
	env: Bindings,
	userId: string,
	id?: string,
) {
	if (!websiteConfig.storage.enabled)
		throw new HttpError(404, "Storage disabled.");
	if (request.method === "GET" && id) {
		if (new URL(request.url).searchParams.get("info") === "1")
			return json(await getFileInfo(env, userId, id));
		const { metadata: file, body } = await downloadFile(env, userId, id);
		return new Response(body, {
			headers: {
				"content-type": downloadContentType(file.contentType),
				"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
				"x-content-type-options": "nosniff",
				"cache-control": "private, max-age=60",
				"content-security-policy": "default-src 'none'; sandbox",
			},
		});
	}
	if (request.method === "GET") {
		const url = new URL(request.url);
		return json(
			await listFiles(
				env,
				userId,
				url.searchParams.get("cursor") || undefined,
				Number(url.searchParams.get("limit") || 20),
			),
		);
	}
	if (request.method === "POST") {
		const max = websiteConfig.storage.maxSize + 16_384;
		const length = Number(request.headers.get("content-length") || 0);
		if (length > max) throw new HttpError(413, "Upload too large.");
		// Bound streamed multipart bodies before formData buffers them.
		const reader = request.body?.getReader();
		if (!reader) throw new HttpError(400, "File required.");
		const chunks: Uint8Array[] = [];
		let total = 0;
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			total += value.length;
			if (total > max) {
				await reader.cancel();
				throw new HttpError(413, "Upload too large.");
			}
			chunks.push(value);
		}
		const form = await new Response(new Blob(chunks as BlobPart[]), {
			headers: { "content-type": request.headers.get("content-type") || "" },
		}).formData();
		const file = form.get("file");
		if (!(file instanceof File)) throw new HttpError(400, "File required.");
		return json(
			await uploadFile(env, userId, file, {
				folder:
					typeof form.get("folder") === "string"
						? (form.get("folder") as string)
						: undefined,
			}),
			201,
		);
	}
	if (request.method === "DELETE") {
		const data = z
			.object({ id: z.string().uuid() })
			.parse(id ? { id } : await readJson(request));
		await deleteFile(env, userId, data.id);
		return json({ ok: true });
	}
	throw new HttpError(405, "Method not allowed.");
}
