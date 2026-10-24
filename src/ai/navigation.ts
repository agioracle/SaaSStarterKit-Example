import { AI_CARDS } from "./types";

export type AiTask = (typeof AI_CARDS)[number]["id"];
export const DEFAULT_AI_TASK: AiTask = "summarize";

export function aiTaskFromHash(hash: string): AiTask | null {
	if (!hash || hash === "#") return DEFAULT_AI_TASK;
	if (!hash.startsWith("#")) return null;
	let id: string;
	try {
		id = decodeURIComponent(hash.slice(1));
	} catch {
		return null;
	}
	if (id === "decision-model") return "decision";
	return AI_CARDS.find((card) => card.id === id)?.id ?? null;
}

export function aiTaskHash(task: AiTask): string {
	return `#${task === "decision" ? "decision-model" : task}`;
}

interface HashNavigationSource {
	location: { hash: string };
	addEventListener(type: "hashchange" | "popstate", listener: () => void): void;
	removeEventListener(
		type: "hashchange" | "popstate",
		listener: () => void,
	): void;
}

/** Observe the initial URL and browser history without duplicating a transition. */
export function observeAiTaskNavigation(
	source: HashNavigationSource,
	select: (task: AiTask) => void,
) {
	let previous: AiTask | null = null;
	const sync = () => {
		const next = aiTaskFromHash(source.location.hash);
		if (next !== null && next !== previous) {
			previous = next;
			select(next);
		}
	};
	source.addEventListener("hashchange", sync);
	source.addEventListener("popstate", sync);
	sync();
	return () => {
		source.removeEventListener("hashchange", sync);
		source.removeEventListener("popstate", sync);
	};
}

/** Abort is best effort: the version check also rejects late JSON/audio/FileReader results. */
export function createAiRequestTracker() {
	let version = 0;
	let controller: AbortController | null = null;
	const invalidate = () => {
		version++;
		controller?.abort();
		controller = null;
	};
	const snapshot = () => {
		const current = version;
		return () => current === version;
	};
	return {
		invalidate,
		snapshot,
		start() {
			invalidate();
			controller = new AbortController();
			return { signal: controller.signal, isCurrent: snapshot() };
		},
	};
}

/** Effective limits are the intersection of the public API and provider-service contracts. */
export function aiTextConstraints(task: AiTask) {
	const limits: Record<
		AiTask,
		{ minLength: number; maxLength: number; required: boolean }
	> = {
		"web-search": { minLength: 1, maxLength: 1024, required: true },
		decision: { minLength: 10, maxLength: 4000, required: true },
		summarize: { minLength: 50, maxLength: 500, required: true },
		translate: { minLength: 1, maxLength: 5000, required: true },
		taglines: { minLength: 10, maxLength: 500, required: true },
		speech: { minLength: 1, maxLength: 2000, required: true },
		caption: { minLength: 1, maxLength: 1000, required: false },
		"workers-image": { minLength: 3, maxLength: 2000, required: true },
		"fal-image": { minLength: 3, maxLength: 2000, required: true },
		avatar: { minLength: 3, maxLength: 2000, required: true },
	};
	return limits[task];
}

export { validSearchResults } from "../lib/web-search";
