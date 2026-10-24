import {
	AI_DEFAULT_MODELS,
	AI_MODEL_UNITS,
	type AiModelKey,
} from "../config/ai-models";
export { AI_MODEL_UNITS, type AiModelKey } from "../config/ai-models";

/** Public deployment controls, not subscription credits or currency estimates. */
export interface AiUsagePolicy {
	enabled: boolean;
	userDailyRequests: number;
	globalDailyRequests: number;
	userDailyUnits: number;
	globalDailyUnits: number;
	userConcurrent: number;
	globalConcurrent: number;
	leaseSeconds: number;
	retentionDays: number;
}

/** Enabling AI is an explicit owner decision, independent of sign-up or keys. */
export const DEFAULT_AI_POLICY: AiUsagePolicy = {
	enabled: false,
	userDailyRequests: 20,
	globalDailyRequests: 200,
	userDailyUnits: 40,
	globalDailyUnits: 400,
	userConcurrent: 1,
	globalConcurrent: 4,
	leaseSeconds: 180,
	retentionDays: 30,
};

export function aiModelKey(input: {
	task: string;
	model?: string;
	provider?: string;
}): AiModelKey {
	const key =
		input.task === "web-search"
			? `${input.task}:${input.provider ?? AI_DEFAULT_MODELS.searchProvider}`
			: input.task === "decision"
				? `${input.task}:${input.model ?? AI_DEFAULT_MODELS.decision}`
				: input.task === "workers-image"
					? `${input.task}:${input.model ?? AI_DEFAULT_MODELS.workersImage}`
					: input.task === "fal-image"
						? `${input.task}:${input.model ?? AI_DEFAULT_MODELS.falImage}`
						: input.task;
	if (!Object.hasOwn(AI_MODEL_UNITS, key))
		throw new Error("AI model has no capacity weight.");
	return key as AiModelKey;
}

/** Returns a safe diagnostic suitable for doctor without reading credentials. */
export function aiPolicyIssue(policy: AiUsagePolicy): string | undefined {
	if (typeof policy.enabled !== "boolean") return "AI enabled must be boolean.";
	const bounded = (value: number, min: number, max: number) =>
		Number.isSafeInteger(value) && value >= min && value <= max;
	if (
		!bounded(policy.userDailyRequests, 1, 10_000) ||
		!bounded(policy.globalDailyRequests, 1, 10_000) ||
		!bounded(policy.userDailyUnits, 1, 1_000_000) ||
		!bounded(policy.globalDailyUnits, 1, 1_000_000) ||
		!bounded(policy.userConcurrent, 1, 100) ||
		!bounded(policy.globalConcurrent, 1, 100) ||
		!bounded(policy.leaseSeconds, 150, 600) ||
		!bounded(policy.retentionDays, 1, 365)
	)
		return "AI requires finite positive daily limits, concurrency limits, and a 150–600 second lease.";
	if (
		policy.userDailyRequests > policy.globalDailyRequests ||
		policy.userDailyUnits > policy.globalDailyUnits ||
		policy.userConcurrent > policy.globalConcurrent
	)
		return "AI per-user limits must not exceed global limits.";
	return undefined;
}
