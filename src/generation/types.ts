/** Browser-safe product contract. No provider keys or external asset URLs are exposed. */
export const MODEL_IDS = ["fal-flux-schnell", "workers-flux-schnell"] as const;
export type ModelId = (typeof MODEL_IDS)[number];
export const ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export type GenerationProvider = "fal" | "cloudflare";
export type GenerationStatus =
	| "dispatching"
	| "queued"
	| "processing"
	| "unknown"
	| "succeeded"
	| "failed"
	| "deleting"
	| "deleted";
export interface GenerationModel {
	id: ModelId;
	label: string;
	provider: GenerationProvider;
	description: string;
	aspectRatios: readonly AspectRatio[];
	supportsSeed: boolean;
	available: boolean;
	unavailableReason: string | null;
}
export interface GenerationInput {
	model: ModelId;
	prompt: string;
	aspectRatio: AspectRatio;
	seed?: number;
	idempotencyKey: string;
}
export interface GenerationJob {
	id: string;
	model: ModelId;
	provider: GenerationProvider;
	prompt: string;
	aspectRatio: AspectRatio;
	seed: number | null;
	status: GenerationStatus;
	createdAt: number;
	updatedAt: number;
	error: string | null;
	assetUrl: string | null;
	downloadUrl: string | null;
	canRefresh: boolean;
	canDelete: boolean;
	width: number | null;
	height: number | null;
}
export interface GenerationUsage {
	period: string;
	plan: "free" | "pro";
	limit: number;
	used: number;
	reserved: number;
	remaining: number;
	concurrencyLimit: number;
	active: number;
	retained: number;
	retainedLimit: number;
}
export interface GenerationConfig {
	models: GenerationModel[];
	usage: GenerationUsage;
	available: boolean;
	unavailableReason: string | null;
}
export interface GenerationResult {
	job: GenerationJob;
	usage: GenerationUsage;
}
export interface GenerationList {
	jobs: GenerationJob[];
	nextCursor: string | null;
}
