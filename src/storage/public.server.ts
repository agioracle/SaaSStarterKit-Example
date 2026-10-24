import { and, eq } from "drizzle-orm";
import { getRequest } from "@tanstack/react-start/server";
import { bindings } from "../api/runtime.server";
import { requireUser } from "../auth/index.server";
import { websiteConfig } from "../config/website";
import { getDb } from "../db";
import { userfiles } from "../db/schema";
import type { Bindings } from "../env";
import { publicEnvironment } from "../env";
import { assertSameOrigin, HttpError } from "../lib/security";
import * as storage from "./index.server";

export interface UploadOptions {
	folder?: string;
	userId?: string;
}
export interface StorageContext {
	env: Bindings;
	request: Request;
}
/** Request-scoped facade. A supplied user ID never delegates authority. */
export function createStorageFacade(
	context: () => StorageContext = () => ({
		env: bindings(),
		request: getRequest(),
	}),
) {
	async function authorized(mutation: boolean, requestedUser?: string) {
		const { env, request } = context();
		if (!websiteConfig.storage.enabled)
			throw new HttpError(404, "Storage disabled.");
		if (mutation) assertSameOrigin(request, publicEnvironment(env).APP_URL);
		const { user } = await requireUser(request, env);
		if (requestedUser !== undefined && requestedUser !== user.id)
			throw new HttpError(
				403,
				"Storage identity must match the signed-in user.",
			);
		return { env, userId: user.id };
	}
	async function byKey(env: Bindings, userId: string, key: string) {
		if (typeof key !== "string" || !key || key.length > 1024)
			throw new HttpError(400, "Invalid object key.");
		const row = await getDb(env.DB)
			.select()
			.from(userfiles)
			.where(and(eq(userfiles.userId, userId), eq(userfiles.key, key)))
			.get();
		if (!row) throw new HttpError(404, "File not found.");
		return row;
	}
	return {
		async uploadFile(
			fileBuffer: ArrayBuffer | Uint8Array,
			fileName: string,
			contentType: string,
			options: UploadOptions = {},
		) {
			const { env, userId } = await authorized(true, options.userId);
			if (
				!(fileBuffer instanceof ArrayBuffer) &&
				!(fileBuffer instanceof Uint8Array)
			)
				throw new HttpError(400, "File buffer required.");
			if (fileBuffer.byteLength > websiteConfig.storage.maxSize)
				throw new HttpError(413, "File exceeds upload size limit.");
			const bytes =
				fileBuffer instanceof Uint8Array
					? Uint8Array.from(fileBuffer).buffer
					: fileBuffer;
			const uploaded = await storage.uploadFile(
				env,
				userId,
				new File([bytes], fileName, { type: contentType }),
				options,
			);
			const metadata = await storage.findFile(env, userId, uploaded.id);
			return { url: uploaded.url, key: metadata.key, metadata };
		},
		async downloadFile(key: string) {
			const { env, userId } = await authorized(false);
			const row = await byKey(env, userId, key);
			return (await storage.downloadFile(env, userId, row.id)).body;
		},
		async deleteFile(key: string) {
			const { env, userId } = await authorized(true);
			const row = await byKey(env, userId, key);
			await storage.deleteFile(env, userId, row.id);
		},
		async getFileInfo(key: string) {
			const { env, userId } = await authorized(false);
			const row = await byKey(env, userId, key);
			return { ...(await storage.getFileInfo(env, userId, row.id)), key };
		},
		async listUserFiles(
			userId: string,
			options: { limit?: number; cursor?: string } = {},
		) {
			const context = await authorized(false, userId);
			return storage.listFiles(
				context.env,
				context.userId,
				options.cursor,
				options.limit,
			);
		},
	};
}
const facade = createStorageFacade();
export const {
	uploadFile,
	downloadFile,
	deleteFile,
	getFileInfo,
	listUserFiles,
} = facade;
