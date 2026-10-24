/**
 * Authoritative, client-safe AI model configuration. Edit selections, defaults,
 * provider IDs and relative capacity weights here; adapters and policy import
 * this module directly. Never place credentials or inference clients here.
 * See src/ai/MODEL_CONFIGURATION.md for extension and verification steps.
 */
export const SEARCH_PROVIDERS = ["ceramic", "exa", "linkup"] as const;
export const TRANSLATION_LANGUAGES = [
	"en",
	"zh",
	"es",
	"fr",
	"de",
	"ja",
	"ko",
	"pt",
	"ru",
	"ar",
] as const;
export const SPEECH_VOICES = [
	"asteria",
	"luna",
	"athena",
	"hera",
	"arcas",
	"orion",
	"orpheus",
	"zeus",
] as const;
export const WORKERS_IMAGE_MODELS = [
	"flux-2-klein-4b",
	"flux-2-klein-9b",
	"flux-1-schnell",
] as const;
export const FAL_IMAGE_MODELS = [
	"flux-schnell",
	"nano-banana",
	"gpt-image-2",
] as const;
export const DECISION_MODELS = ["clef", "clef-flash"] as const;

export const AI_DEFAULT_MODELS = {
	searchProvider: SEARCH_PROVIDERS[0],
	decision: DECISION_MODELS[0],
	speechVoice: SPEECH_VOICES[0],
	workersImage: WORKERS_IMAGE_MODELS[0],
	falImage: FAL_IMAGE_MODELS[0],
} as const;

export const AI_PROVIDER_MODELS = {
	textAndCaption: "@cf/google/gemma-4-26b-a4b-it",
	translation: "@cf/meta/m2m100-1.2b",
	speech: "@cf/deepgram/aura-2-en",
	decision: {
		clef: "@cf/cloudflare/clef",
		"clef-flash": "@cf/cloudflare/clef-flash",
	},
	workersImage: {
		"flux-2-klein-4b": "@cf/black-forest-labs/flux-2-klein-4b",
		"flux-2-klein-9b": "@cf/black-forest-labs/flux-2-klein-9b",
		"flux-1-schnell": "@cf/black-forest-labs/flux-1-schnell",
	},
	falImage: {
		"flux-schnell": "fal-ai/flux/schnell",
		"nano-banana": "fal-ai/nano-banana",
		"gpt-image-2": "openai/gpt-image-2",
	},
	avatar: "fal-ai/nano-banana/edit",
} as const;

/** Conservative relative capacity units. These are NOT provider prices. */
export const AI_MODEL_UNITS = {
	"web-search:ceramic": 2,
	"web-search:exa": 2,
	"web-search:linkup": 2,
	"decision:clef": 2,
	"decision:clef-flash": 1,
	summarize: 1,
	translate: 1,
	taglines: 1,
	speech: 2,
	caption: 2,
	"workers-image:flux-1-schnell": 4,
	"workers-image:flux-2-klein-4b": 6,
	"workers-image:flux-2-klein-9b": 10,
	"fal-image:flux-schnell": 4,
	"fal-image:nano-banana": 8,
	"fal-image:gpt-image-2": 12,
	avatar: 8,
} as const;
export type AiModelKey = keyof typeof AI_MODEL_UNITS;
