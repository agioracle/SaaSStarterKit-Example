import {
	SEARCH_PROVIDERS,
	TRANSLATION_LANGUAGES,
	SPEECH_VOICES,
	WORKERS_IMAGE_MODELS,
	FAL_IMAGE_MODELS,
	DECISION_MODELS,
} from "../config/ai-models";
export {
	SEARCH_PROVIDERS,
	TRANSLATION_LANGUAGES,
	SPEECH_VOICES,
	WORKERS_IMAGE_MODELS,
	FAL_IMAGE_MODELS,
	DECISION_MODELS,
};
export const AI_CARDS = [
	{ id: "web-search", title: "Web search", provider: "Cloudflare Web Search" },
	{ id: "decision", title: "Decision", provider: "Cloudflare Clef" },
	{ id: "summarize", title: "Summarization", provider: "Gemma 4" },
	{ id: "translate", title: "Translation", provider: "M2M100" },
	{ id: "taglines", title: "SaaS tagline generator", provider: "Gemma 4" },
	{ id: "speech", title: "Text to speech", provider: "Aura 2" },
	{ id: "caption", title: "Image captioning", provider: "Gemma 4" },
	{
		id: "workers-image",
		title: "Image generation · Workers AI",
		provider: "FLUX",
	},
	{ id: "fal-image", title: "Image generation · fal.ai", provider: "fal.ai" },
	{ id: "avatar", title: "Avatar editing", provider: "Nano Banana" },
] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];
export type SpeechVoice = (typeof SPEECH_VOICES)[number];
export type WorkersImageModel = (typeof WORKERS_IMAGE_MODELS)[number];
export type FalImageModel = (typeof FAL_IMAGE_MODELS)[number];
export type DecisionModel = (typeof DECISION_MODELS)[number];
export interface SearchResult {
	items: Array<{ url: string; title: string; description: string }>;
}
export interface ImageResult {
	images: Array<{ url: string; contentType: string }>;
}
export interface DecisionResult {
	model: DecisionModel;
	answers: {
		urgent: { type: "noul"; noul: number };
		team: {
			type: "choice";
			choice: "billing" | "technical" | "sales";
			probabilities: Record<"billing" | "technical" | "sales", number>;
			confidence: number;
		};
		severity: {
			type: "score";
			score: number;
			legend: Record<"0" | "1" | "2" | "3", string>;
			probabilities: Record<"0" | "1" | "2" | "3", number>;
			confidence: number;
		};
	};
	usage: { input_tokens: number; output_tokens: number };
}
export interface AudioResult {
	bytes: Uint8Array;
	contentType: "audio/mpeg";
}
/** Server configuration, never serialize or put in client environment variables. */
export interface AiConfig {
	cloudflare?: {
		accountId: string;
		apiToken: string;
		gatewayId?: string;
		byokAlias?: string;
	};
	fal?: { apiKey: string };
}
export interface AiService {
	webSearch(input: {
		query: string;
		provider?: SearchProvider;
		limit?: number;
	}): Promise<SearchResult>;
	decide(input: {
		text: string;
		model?: DecisionModel;
	}): Promise<DecisionResult>;
	summarize(text: string): Promise<string>;
	translate(input: {
		text: string;
		source: TranslationLanguage;
		target: TranslationLanguage;
	}): Promise<string>;
	taglines(description: string): Promise<string[]>;
	speak(input: { text: string; voice?: SpeechVoice }): Promise<AudioResult>;
	caption(input: { image: string; prompt?: string }): Promise<string>;
	generateWorkersImage(input: {
		prompt: string;
		model?: WorkersImageModel;
		width?: number;
		height?: number;
	}): Promise<ImageResult>;
	generateFalImage(input: {
		prompt: string;
		model?: FalImageModel;
	}): Promise<ImageResult>;
	editAvatar(input: { image: string; prompt: string }): Promise<ImageResult>;
}
