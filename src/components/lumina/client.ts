import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	GenerationConfig,
	GenerationJob,
	GenerationResult,
} from "../../generation/types";

export class GenerationRequestError extends Error {
	constructor(
		message: string,
		public status: number,
	) {
		super(message);
	}
}
export async function generationRequest<T>(
	path: string,
	options?: RequestInit,
): Promise<T> {
	const response = await fetch(path, {
		credentials: "same-origin",
		...options,
		headers: {
			...(options?.body ? { "Content-Type": "application/json" } : {}),
			...options?.headers,
		},
	});
	const data = (await response.json().catch(() => null)) as {
		error?: string | { message?: string };
		message?: string;
	} | null;
	if (!response.ok) {
		const error = data?.error;
		throw new GenerationRequestError(
			typeof error === "string"
				? error
				: error?.message ||
						data?.message ||
						`Request failed (${response.status})`,
			response.status,
		);
	}
	return data as T;
}
export function useGenerationConfig() {
	return useQuery({
		queryKey: ["lumina-config"],
		queryFn: ({ signal }) =>
			generationRequest<GenerationConfig>("/api/generations/config", {
				signal,
			}),
		retry: false,
		staleTime: 15_000,
	});
}
export function useGenerationJob(id?: string) {
	const client = useQueryClient();
	const activeId = useRef(id);
	activeId.current = id;
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const [refreshing, setRefreshing] = useState(false);
	const [pollError, setPollError] = useState("");
	const query = useQuery({
		queryKey: ["lumina-job", id],
		queryFn: async ({ signal }) =>
			(
				await generationRequest<{ job: GenerationJob }>(
					`/api/generations/${encodeURIComponent(id || "")}`,
					{ signal },
				)
			).job,
		enabled: !!id,
		retry: false,
	});
	const refresh = useCallback(
		async (signal?: AbortSignal) => {
			if (!id) return;
			setRefreshing(true);
			setPollError("");
			try {
				const result = await generationRequest<GenerationResult>(
					`/api/generations/${encodeURIComponent(id)}/refresh`,
					{ method: "POST", signal },
				);
				if (signal?.aborted || !mounted.current || activeId.current !== id)
					return;
				client.setQueryData(["lumina-job", id], result.job);
				client.setQueryData<GenerationConfig>(["lumina-config"], (value) =>
					value ? { ...value, usage: result.usage } : value,
				);
				if (["succeeded", "failed", "unknown"].includes(result.job.status))
					void client.invalidateQueries({ queryKey: ["lumina-library"] });
			} catch (error) {
				if (!signal?.aborted && mounted.current && activeId.current === id)
					setPollError(
						error instanceof Error ? error.message : "Request interrupted",
					);
			} finally {
				if (!signal?.aborted && mounted.current && activeId.current === id)
					setRefreshing(false);
			}
		},
		[id, client],
	);
	useEffect(() => {
		if (id) {
			setPollError("");
			setRefreshing(false);
		}
	}, [id]);
	useEffect(() => {
		const job = query.data;
		if (!query.dataUpdatedAt) return; // Re-arm after every response, even when structural sharing preserves the job object.
		if (
			!job?.canRefresh ||
			!["dispatching", "queued", "processing"].includes(job.status) ||
			pollError
		)
			return;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			void refresh(controller.signal);
		}, 4000);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query.data, query.dataUpdatedAt, refresh, pollError]);
	return { ...query, refreshing, pollError, refresh };
}
