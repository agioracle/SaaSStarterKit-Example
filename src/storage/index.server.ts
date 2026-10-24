import { and, eq, desc, lt, or } from "drizzle-orm";
import { getDb } from "../db";
import { userfiles } from "../db/schema";
import type { Bindings } from "../env";
import { websiteConfig } from "../config/website";
import { HttpError } from "../lib/security";
import {
	downloadContentType,
	validateUpload,
	validateMagicBytes,
	normalizeStorageFolder,
	decodeFileCursor,
} from "./index";
export async function uploadFile(
	env: Bindings,
	userId: string,
	file: File,
	options: { folder?: string } = {},
) {
	const { extension, contentType } = validateUpload(
		file,
		websiteConfig.storage.allowedTypes,
		websiteConfig.storage.maxSize,
	);
	const bytes = await file.arrayBuffer();
	validateMagicBytes(new Uint8Array(bytes), contentType);
	const id = crypto.randomUUID();
	const key = `${normalizeStorageFolder(options.folder || websiteConfig.storage.userFilesFolder)}/${encodeURIComponent(userId)}/${id}.${extension}`;
	await env.BUCKET.put(key, bytes, {
		httpMetadata: {
			contentType: downloadContentType(contentType),
			contentDisposition: "attachment",
		},
		customMetadata: { userId },
	});
	try {
		await getDb(env.DB).insert(userfiles).values({
			id,
			userId,
			key,
			name: file.name,
			contentType,
			size: file.size,
			createdAt: new Date(),
		});
	} catch (error) {
		await env.BUCKET.delete(key);
		throw error;
	}
	return {
		id,
		name: file.name,
		size: file.size,
		contentType,
		url: `/api/files/${id}`,
	};
}
export async function listFiles(
	env: Bindings,
	userId: string,
	cursor?: string,
	limit = 20,
) {
	if (!Number.isInteger(limit) || limit < 1 || limit > 100)
		throw new HttpError(400, "Invalid page size.");
	let position: { date: Date; id: string } | undefined;
	if (cursor) position = decodeFileCursor(cursor);
	const where = position
		? and(
				eq(userfiles.userId, userId),
				or(
					lt(userfiles.createdAt, position.date),
					and(
						eq(userfiles.createdAt, position.date),
						lt(userfiles.id, position.id),
					),
				),
			)
		: eq(userfiles.userId, userId);
	const rows = await getDb(env.DB)
		.select()
		.from(userfiles)
		.where(where)
		.orderBy(desc(userfiles.createdAt), desc(userfiles.id))
		.limit(limit + 1);
	const hasMore = rows.length > limit;
	const page = rows.slice(0, limit);
	const last = page.at(-1);
	const files = page.map(({ key: _, ...row }) => ({
		...row,
		url: `/api/files/${row.id}`,
	}));
	return {
		files,
		objects: files,
		hasMore,
		nextCursor:
			hasMore && last
				? btoa(JSON.stringify({ time: last.createdAt.getTime(), id: last.id }))
				: null,
	};
}
export async function findFile(env: Bindings, userId: string, id: string) {
	const file = await getDb(env.DB)
		.select()
		.from(userfiles)
		.where(and(eq(userfiles.id, id), eq(userfiles.userId, userId)))
		.get();
	if (!file) throw new HttpError(404, "File not found.");
	return file;
}
export async function deleteFile(env: Bindings, userId: string, id: string) {
	const file = await findFile(env, userId, id);
	await env.BUCKET.delete(file.key);
	await getDb(env.DB)
		.delete(userfiles)
		.where(and(eq(userfiles.id, id), eq(userfiles.userId, userId)));
}

export async function getFileInfo(env: Bindings, userId: string, id: string) {
	const { key, ...metadata } = await findFile(env, userId, id);
	const object = await env.BUCKET.head(key);
	if (!object) throw new HttpError(404, "File not found.");
	return { ...metadata, url: `/api/files/${id}`, etag: object.httpEtag };
}
export async function downloadFile(env: Bindings, userId: string, id: string) {
	const metadata = await findFile(env, userId, id);
	const object = await env.BUCKET.get(metadata.key);
	if (!object) throw new HttpError(404, "File not found.");
	return { metadata, body: object.body };
}
