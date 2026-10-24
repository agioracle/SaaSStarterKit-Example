import "@tanstack/react-start/server-only";
import { websiteConfig } from "../config/website";
import { aiPolicyIssue } from "../ai/policy";
import type { Bindings } from "../env";
import { createD1PaymentStore } from "../db/payment-store";
import { HttpError } from "../lib/security";
import { ASPECT_RATIOS, type GenerationModel, type ModelId } from "./types";

function secret(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.trim().length >= 8 &&
		!/replace|placeholder|change.?me|your[_ -]?(key|token)|example/i.test(value)
	);
}
export function modelCatalog(env: Bindings): GenerationModel[] {
	const enabled =
		websiteConfig.ai.enabled &&
		!aiPolicyIssue(websiteConfig.ai) &&
		env.IMAGE_GENERATION_ENABLED === "true" &&
		Boolean(env.DB) &&
		Boolean(env.BUCKET);
	const fal = enabled && secret(env.FAL_API_KEY);
	const workers =
		enabled &&
		typeof env.CLOUDFLARE_ACCOUNT_ID === "string" &&
		/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID) &&
		secret(env.CLOUDFLARE_AI_API_TOKEN);
	const reason = enabled
		? "The site owner must configure this model provider before generation is available."
		: "Image generation is not enabled. The site owner must configure D1, private R2, model credentials, and IMAGE_GENERATION_ENABLED.";
	return [
		{
			id: "fal-flux-schnell",
			label: "FLUX Schnell",
			provider: "fal",
			description:
				"Fast images with flexible aspect ratios and an optional seed.",
			aspectRatios: ASPECT_RATIOS,
			supportsSeed: true,
			available: fal,
			unavailableReason: fal ? null : reason,
		},
		{
			id: "workers-flux-schnell",
			label: "FLUX on Workers AI",
			provider: "cloudflare",
			description: "Cloudflare-hosted FLUX with a fixed square output.",
			aspectRatios: ["1:1"],
			supportsSeed: false,
			available: workers,
			unavailableReason: workers ? null : reason,
		},
	];
}
export function requireModel(env: Bindings, model: ModelId) {
	const entry = modelCatalog(env).find((item) => item.id === model);
	if (!entry?.available)
		throw new HttpError(503, entry?.unavailableReason || "Model unavailable.");
	return entry;
}
function limit(env: Bindings, key: string, fallback: number, max: number) {
	const value = env[key];
	if (value === undefined || value === "") return fallback;
	if (typeof value !== "string" || !/^\d+$/.test(value))
		throw new HttpError(
			503,
			"The image quota configuration is invalid. Contact the site owner.",
		);
	const result = Number(value);
	if (!Number.isSafeInteger(result) || result < 1 || result > max)
		throw new HttpError(
			503,
			"The image quota configuration is invalid. Contact the site owner.",
		);
	return result;
}
export async function generationPolicy(
	env: Bindings,
	userId: string,
	now = Date.now(),
) {
	const store = createD1PaymentStore(env.DB);
	if (!store.getEntitlement)
		throw new HttpError(503, "Payment entitlement projection is unavailable.");
	const entitlement = await store.getEntitlement(userId, now);
	const paid =
		entitlement &&
		["pro-monthly", "pro-yearly", "lifetime"].includes(entitlement.plan.id);
	return {
		plan: paid ? ("pro" as const) : ("free" as const),
		limit: limit(
			env,
			paid ? "IMAGE_PRO_MONTHLY_LIMIT" : "IMAGE_FREE_MONTHLY_LIMIT",
			paid ? 200 : 10,
			10000,
		),
		retainedLimit: limit(
			env,
			paid ? "IMAGE_PRO_RETAINED_LIMIT" : "IMAGE_FREE_RETAINED_LIMIT",
			paid ? 500 : 30,
			10000,
		),
		concurrencyLimit: Math.min(limit(env, "IMAGE_MAX_CONCURRENT", 2, 10), websiteConfig.ai.userConcurrent),
	};
}
