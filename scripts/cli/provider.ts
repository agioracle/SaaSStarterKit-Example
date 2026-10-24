import {
	isObject,
	type Resource,
	type ResourceKind,
	type SetupConfig,
	validId,
} from "./config.ts";

export class ProviderError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly uncertain = false,
	) {
		super(message);
	}
}
export interface CloudflareApi {
	request(
		method: "GET" | "POST" | "DELETE",
		path: string,
		body?: unknown,
	): Promise<unknown>;
}
export function createCloudflareApi(
	accountId: string,
	token: string,
	fetcher: typeof fetch = fetch,
): CloudflareApi {
	if (!/^[a-f0-9]{32}$/i.test(accountId) || !token.trim())
		throw new Error("Cloudflare account ID and API token are required.");
	return {
		async request(method, path, body) {
			if (!path.startsWith("/") || path.includes("..") || /^\/\//.test(path))
				throw new Error("Invalid API resource path.");
			let response: Response;
			try {
				response = await fetcher(
					`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
					{
						method,
						headers: {
							Authorization: `Bearer ${token}`,
							"Content-Type": "application/json",
						},
						body: body === undefined ? undefined : JSON.stringify(body),
						signal: AbortSignal.timeout(30_000),
						redirect: "error",
					},
				);
			} catch {
				throw new ProviderError(
					`Cloudflare ${method} request failed. ${method === "GET" ? "No remote mutation was attempted." : "Outcome is uncertain; inspect the exact resource before retrying."}`,
					undefined,
					method !== "GET",
				);
			}
			let data: unknown;
			try {
				data = await response.json();
			} catch {
				throw new ProviderError(
					"Cloudflare returned an invalid response; mutation outcome may be uncertain.",
					response.status,
					method !== "GET",
				);
			}
			if (!response.ok || !isObject(data) || data.success !== true) {
				// Raw remote error messages can echo headers or secret data. Print status/codes only.
				const codes =
					isObject(data) && Array.isArray(data.errors)
						? data.errors
								.filter(isObject)
								.map((error) =>
									typeof error.code === "number" ? error.code : "unknown",
								)
								.join(",")
						: "unknown";
				throw new ProviderError(
					`Cloudflare request failed (HTTP ${response.status}; codes ${codes}). Check account, token permissions, service enablement, and resource identifiers.`,
					response.status,
					method !== "GET" && response.status >= 500,
				);
			}
			return data;
		},
	};
}
export function resourcePath(kind: ResourceKind, id?: string): string {
	const base =
		kind === "d1"
			? "/d1/database"
			: kind === "r2"
				? "/r2/buckets"
				: "/storage/kv/namespaces";
	return id ? `${base}/${encodeURIComponent(id)}` : base;
}
export function resourceFromResult(
	kind: ResourceKind,
	input: unknown,
	ownership: Resource["ownership"],
): Resource {
	if (!isObject(input)) throw new Error(`Invalid ${kind} provider response.`);
	const id = kind === "d1" ? input.uuid : kind === "kv" ? input.id : input.name;
	const name = kind === "kv" ? input.title : input.name;
	if (typeof id !== "string" || !validId(kind, id) || typeof name !== "string")
		throw new Error(`Invalid ${kind} provider response identifiers.`);
	return { id, name, ownership };
}
export async function getResource(
	api: CloudflareApi,
	kind: ResourceKind,
	id: string,
	name: string,
	ownership: Resource["ownership"],
): Promise<Resource> {
	const response = await api.request("GET", resourcePath(kind, id));
	if (!isObject(response))
		throw new Error(`Invalid ${kind} provider response.`);
	const resource = resourceFromResult(kind, response.result, ownership);
	if (resource.id !== id || resource.name !== name)
		throw new Error(
			`${kind} resource identity does not match the configured ID and name. Refusing to continue.`,
		);
	return resource;
}
export async function findByName(
	api: CloudflareApi,
	kind: ResourceKind,
	name: string,
): Promise<Resource[]> {
	const matches: Resource[] = [];
	let page = 1;
	let pagesRead = 0;
	let cursor: string | undefined;
	do {
		pagesRead++;
		const query =
			kind === "r2"
				? `?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
				: `?per_page=100&page=${page}`;
		const response = await api.request("GET", `${resourcePath(kind)}${query}`);
		if (!isObject(response)) throw new Error(`Invalid ${kind} list response.`);
		const result =
			kind === "r2" && isObject(response.result)
				? response.result.buckets
				: response.result;
		if (!Array.isArray(result))
			throw new Error(`Invalid ${kind} list response.`);
		for (const item of result) {
			const resource = resourceFromResult(kind, item, "adopted");
			if (resource.name === name) matches.push(resource);
		}
		if (kind === "r2") {
			cursor =
				isObject(response.result_info) &&
				typeof response.result_info.cursor === "string"
					? response.result_info.cursor
					: undefined;
			if (!cursor) break;
		} else {
			const total = isObject(response.result_info)
				? Number(response.result_info.total_pages)
				: 0;
			if ((total && page >= total) || (!total && result.length < 100)) break;
			page++;
		}
		if (pagesRead >= 1000)
			throw new Error(
				"Resource listing exceeded the safety limit. Adopt exact resource IDs instead.",
			);
	} while (pagesRead < 1000);
	return matches;
}
export function assertAccount(
	config: SetupConfig,
	environment: NodeJS.ProcessEnv,
): { accountId: string; token: string } {
	const accountId = config.accountId || environment.CLOUDFLARE_ACCOUNT_ID;
	if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId))
		throw new Error(
			"Set accountId in setup.json or CLOUDFLARE_ACCOUNT_ID in the shell.",
		);
	if (
		config.accountId &&
		environment.CLOUDFLARE_ACCOUNT_ID &&
		config.accountId !== environment.CLOUDFLARE_ACCOUNT_ID
	)
		throw new Error(
			"Shell Cloudflare account differs from the explicitly configured account.",
		);
	const token = environment.CLOUDFLARE_API_TOKEN;
	if (!token)
		throw new Error(
			"CLOUDFLARE_API_TOKEN is missing. Supply it through the shell, not setup/state files.",
		);
	return { accountId, token };
}
