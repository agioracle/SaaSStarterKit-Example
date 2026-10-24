import { SEARCH_PROVIDERS, AI_DEFAULT_MODELS } from "../config/ai-models";
export { SEARCH_PROVIDERS } from "../config/ai-models";
export type { SearchProvider, SearchResult } from "../ai/types";

/** Client-safe validation only; this module never contacts a provider. */
export function normalizeWebSearchInput(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Search input must be an object.");
	const input = value as {
		query?: unknown;
		provider?: unknown;
		limit?: unknown;
	};
	if (typeof input.query !== "string") throw new Error("Query must be text.");
	const query = input.query.trim();
	if (query.length < 1 || query.length > 1024)
		throw new Error("Query must be 1–1024 characters.");
	const provider = input.provider ?? AI_DEFAULT_MODELS.searchProvider;
	if (
		typeof provider !== "string" ||
		!SEARCH_PROVIDERS.includes(provider as (typeof SEARCH_PROVIDERS)[number])
	)
		throw new Error("Invalid search provider.");
	const limit = input.limit ?? 5;
	if (
		typeof limit !== "number" ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 10
	)
		throw new Error("Search limit must be 1–10.");
	return {
		query,
		provider: provider as (typeof SEARCH_PROVIDERS)[number],
		limit,
	};
}

export function validSearchUrl(value: string) {
	try {
		const url = new URL(value);
		return (
			["http:", "https:"].includes(url.protocol) &&
			Boolean(url.hostname) &&
			!url.username &&
			!url.password
		);
	} catch {
		return false;
	}
}

export function validSearchResults(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (
			!item ||
			typeof item !== "object" ||
			typeof item.url !== "string" ||
			typeof item.title !== "string" ||
			typeof item.description !== "string"
		)
			return [];
		try {
			const url = new URL(item.url);
			if (
				!["http:", "https:"].includes(url.protocol) ||
				!url.hostname ||
				url.username ||
				url.password
			)
				return [];
			return [
				{
					url: url.href,
					hostname: url.hostname,
					title: item.title,
					description: item.description,
				},
			];
		} catch {
			return [];
		}
	});
}
