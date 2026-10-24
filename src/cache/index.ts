import { createServerOnlyFn } from "@tanstack/react-start";
import { websiteConfig } from "../config/website";

export interface Cache {
	get(key: string, type: "json"): Promise<unknown>;
	put(
		key: string,
		value: string,
		options?: { expirationTtl: number },
	): Promise<void>;
	delete(key: string): Promise<void>;
}
export interface PrefixCache {
	list(options: { prefix: string; cursor?: string }): Promise<{
		keys: { name: string }[];
		list_complete: boolean;
		cursor?: string;
	}>;
	delete(key: string): Promise<void>;
}
export interface GetOrSetCacheOptions<T> {
	key: string;
	ttlSeconds?: number;
	fetcher: () => Promise<T>;
	/** Optional explicit binding for tests or dependency-injected server code. */
	cache?: Cache;
}
const runtimeCache = createServerOnlyFn(async () => {
	try {
		return (await import("./runtime.server")).cacheBinding();
	} catch {
		// Optional cache must not prevent execution outside a Worker or during an outage.
		return undefined;
	}
});
export function getOrSetCache<T>(options: GetOrSetCacheOptions<T>): Promise<T>;
export function getOrSetCache<T>(
	cache: Cache | undefined,
	key: string,
	fetcher: () => Promise<T>,
	ttl?: number,
): Promise<T>;
export async function getOrSetCache<T>(
	cacheOrOptions: Cache | GetOrSetCacheOptions<T> | undefined,
	key?: string,
	fetcher?: () => Promise<T>,
	ttl = websiteConfig.cache.ttl,
): Promise<T> {
	const options =
		cacheOrOptions && "fetcher" in cacheOrOptions ? cacheOrOptions : undefined;
	const load = options?.fetcher ?? fetcher;
	if (!load) throw new Error("Cache fetcher is required.");
	// This gate is shared by BOTH public and legacy entry points, including explicit KV bindings.
	if (!websiteConfig.cache.enable) return load();
	const cache = options
		? "cache" in options
			? options.cache
			: await runtimeCache()
		: (cacheOrOptions as Cache | undefined);
	const cacheKey = options?.key ?? key;
	if (!cacheKey) throw new Error("Cache key is required.");
	if (cache) {
		try {
			const cached = await cache.get(cacheKey, "json");
			if (cached !== null && cached !== undefined) return cached as T;
		} catch {
			/* Advisory cache must never block the underlying source. */
		}
	}
	const value = await load();
	if (cache) {
		try {
			const requestedTtl = options?.ttlSeconds ?? ttl;
			if (!Number.isFinite(requestedTtl)) return value;
			const serialized = JSON.stringify(value);
			if (serialized !== undefined)
				await cache.put(cacheKey, serialized, {
					expirationTtl: Math.max(60, Math.ceil(requestedTtl)),
				});
		} catch {
			/* Best effort only. */
		}
	}
	return value;
}
export async function invalidateCache(
	cache: Cache | undefined,
	...keys: string[]
) {
	if (!websiteConfig.cache.enable || !cache) return;
	await Promise.all(
		keys.map(async (key) => {
			try {
				await cache.delete(key);
			} catch {
				/* Best effort. */
			}
		}),
	);
}
export async function invalidateCachePrefix(
	cache: PrefixCache | undefined,
	prefix: string,
) {
	if (!prefix) throw new Error("Cache prefix is required.");
	if (!websiteConfig.cache.enable || !cache) return;
	let cursor: string | undefined;
	const visited = new Set<string>();
	do {
		try {
			const page = await cache.list({ prefix, cursor });
			await Promise.all(
				page.keys.map(async (item) => {
					try {
						await cache.delete(item.name);
					} catch {
						/* Best effort. */
					}
				}),
			);
			if (page.list_complete || !page.cursor || visited.has(page.cursor))
				return;
			cursor = page.cursor;
			visited.add(cursor);
		} catch {
			return;
		}
	} while (cursor);
}
/** Stable segment encoding avoids delimiter collisions. Never pass credentials as segments. */
export function createCacheKey(
	namespace: string,
	...segments: readonly (string | number)[]
) {
	if (!namespace.trim()) throw new Error("Cache namespace is required.");
	return [namespace, ...segments.map(String)].map(encodeURIComponent).join(":");
}
export function deleteCache(key: string): Promise<void>;
export function deleteCache(
	cache: Cache | undefined,
	...keys: string[]
): Promise<void>;
export async function deleteCache(
	cacheOrKey: Cache | string | undefined,
	...keys: string[]
) {
	if (!websiteConfig.cache.enable) return;
	return typeof cacheOrKey === "string"
		? invalidateCache(await runtimeCache(), cacheOrKey)
		: invalidateCache(cacheOrKey, ...keys);
}
export function deleteCacheByPrefix(prefix: string): Promise<void>;
export function deleteCacheByPrefix(
	cache: PrefixCache | undefined,
	prefix: string,
): Promise<void>;
export async function deleteCacheByPrefix(
	cacheOrPrefix: PrefixCache | string | undefined,
	prefix?: string,
) {
	if (!websiteConfig.cache.enable) return;
	return typeof cacheOrPrefix === "string"
		? invalidateCachePrefix(await runtimeCache(), cacheOrPrefix)
		: invalidateCachePrefix(cacheOrPrefix, prefix ?? "");
}
export { CACHE_TTL } from "./constants";
