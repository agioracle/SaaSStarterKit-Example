import "@tanstack/react-start/server-only";
import { env } from "cloudflare:workers";
import type { Cache, PrefixCache } from "./index";
/** Read the current Worker binding; never store request environment globally. */
export function cacheBinding(): (Cache & PrefixCache) | undefined {
	return (env as unknown as { CACHE?: Cache & PrefixCache }).CACHE;
}
