import { createServerOnlyFn } from "@tanstack/react-start";
import { HttpError } from "../lib/security";
export const MIME_BY_EXTENSION: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	gif: "image/gif",
	pdf: "application/pdf",
	txt: "text/plain",
	csv: "text/csv",
	json: "application/json",
	md: "text/markdown",
};
export function validateUpload(
	file: Pick<File, "name" | "size" | "type">,
	allowedTypes: readonly string[],
	maxSize: number,
) {
	if (
		!file.name ||
		file.name.length > 180 ||
		/[/\\]/.test(file.name) ||
		Array.from(file.name).some((character) => character.charCodeAt(0) < 32)
	)
		throw new HttpError(400, "Invalid filename.");
	const ext = file.name.includes(".")
		? file.name.split(".").pop()?.toLowerCase() || ""
		: "";
	if (ext && !/^[a-z0-9_-]{1,32}$/.test(ext))
		throw new HttpError(400, "Invalid file extension.");
	const normalized = allowedTypes.map((value) =>
		value.replace(/^\./, "").toLowerCase(),
	);
	if (normalized.length > 0 && !normalized.includes(ext))
		throw new HttpError(400, "Unsupported file extension or content type.");
	const contentType = (
		file.type ||
		MIME_BY_EXTENSION[ext] ||
		"application/octet-stream"
	)
		.trim()
		.toLowerCase();
	if (
		contentType.length > 127 ||
		!/^[-a-z0-9!#$&^_.+]+\/[-a-z0-9!#$&^_.+]+$/.test(contentType)
	)
		throw new HttpError(400, "Invalid content type.");
	const expected = MIME_BY_EXTENSION[ext];
	if (expected && expected !== contentType)
		throw new HttpError(400, "Unsupported file extension or content type.");
	// A known raster/PDF MIME cannot be disguised under another extension.
	if (STRICT_CONTENT_TYPES.has(contentType) && expected !== contentType)
		throw new HttpError(400, "Unsupported file extension or content type.");
	if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxSize)
		throw new HttpError(413, "File exceeds upload size limit.");
	return { extension: ext || "bin", contentType };
}
const STRICT_CONTENT_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"application/pdf",
]);
/** Only validated raster/PDF types retain their MIME. All other downloads are opaque attachments. */
export function downloadContentType(type: string) {
	return STRICT_CONTENT_TYPES.has(type) ? type : "application/octet-stream";
}

export function validateMagicBytes(bytes: Uint8Array, type: string) {
	if (!STRICT_CONTENT_TYPES.has(type)) {
		if (type.startsWith("text/") || type === "application/json") {
			let text: string;
			try {
				text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			} catch {
				throw new HttpError(400, "Text file must contain valid UTF-8.");
			}
			if (text.includes(String.fromCharCode(0)))
				throw new HttpError(400, "Text file contains binary data.");
			if (type === "application/json") {
				try {
					JSON.parse(text);
				} catch {
					throw new HttpError(400, "Invalid JSON file.");
				}
			}
		}
		return;
	}
	const match = (signature: number[]) =>
		signature.every((b, i) => bytes[i] === b);
	const valid =
		type === "image/png"
			? match([137, 80, 78, 71, 13, 10, 26, 10])
			: type === "image/jpeg"
				? match([255, 216, 255])
				: type === "image/gif"
					? new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/)
					: type === "image/webp"
						? new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
							new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
						: type === "application/pdf"
							? match([37, 80, 68, 70, 45])
							: false;
	if (!valid)
		throw new HttpError(400, "File contents do not match the declared type.");
}

/** Relative folder only. User ownership is separately enforced in D1 and the object key. */
export function normalizeStorageFolder(folder: string) {
	if (
		!folder ||
		folder.length > 160 ||
		!folder.split("/").every((part) => /^[A-Za-z0-9_-]{1,64}$/.test(part))
	)
		throw new HttpError(400, "Invalid storage folder.");
	return folder;
}
export function decodeFileCursor(cursor: string) {
	try {
		if (cursor.length > 1024) throw Error();
		const value = JSON.parse(atob(cursor));
		if (
			!Number.isFinite(value.time) ||
			!Number.isFinite(new Date(value.time).getTime()) ||
			typeof value.id !== "string" ||
			!value.id ||
			value.id.length > 100
		)
			throw Error();
		return { date: new Date(value.time), id: value.id as string };
	} catch {
		throw new HttpError(400, "Invalid file cursor.");
	}
}

/** Public documented server interfaces. Browser code should call authenticated /api/files instead. */
export const uploadFile = createServerOnlyFn(
	async (
		fileBuffer: ArrayBuffer | Uint8Array,
		fileName: string,
		contentType: string,
		options: { folder?: string; userId?: string } = {},
	) =>
		(await import("./public.server")).uploadFile(
			fileBuffer,
			fileName,
			contentType,
			options,
		),
);
export const downloadFile = createServerOnlyFn(async (key: string) =>
	(await import("./public.server")).downloadFile(key),
);
export const deleteFile = createServerOnlyFn(async (key: string) =>
	(await import("./public.server")).deleteFile(key),
);
export const getFileInfo = createServerOnlyFn(async (key: string) =>
	(await import("./public.server")).getFileInfo(key),
);
export const listUserFiles = createServerOnlyFn(
	async (userId: string, options: { limit?: number; cursor?: string } = {}) =>
		(await import("./public.server")).listUserFiles(userId, options),
);
