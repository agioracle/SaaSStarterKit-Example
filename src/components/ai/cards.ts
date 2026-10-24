import type { AiTask } from "../../ai/navigation";
import type { AiToolCard } from "./card-contract";
import { webSearchCard } from "./ai-web-search-card";
import { decisionCard } from "./ai-decision-card";
import { summarizationCard } from "./ai-summarization-card";
import { translationCard } from "./ai-translation-card";
import { taglineCard } from "./ai-tagline-card";
import { ttsCard } from "./ai-tts-card";
import { captionCard } from "./ai-caption-card";
import { cfImageCard } from "./ai-cf-image-card";
import { imageCard } from "./ai-image-card";
import { imageEditCard } from "./ai-image-edit-card";

/** One registry, ten independently editable cards; no card performs network dispatch. */
export const AI_TOOL_CARDS: Record<AiTask, AiToolCard> = {
	"web-search": webSearchCard,
	decision: decisionCard,
	summarize: summarizationCard,
	translate: translationCard,
	taglines: taglineCard,
	speech: ttsCard,
	caption: captionCard,
	"workers-image": cfImageCard,
	"fal-image": imageCard,
	avatar: imageEditCard,
};
