import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { AiService } from "../types";
import { webSearchSchema, runWebSearch } from "./web-search.server";
import { decisionSchema, runDecision } from "./decision.server";
import { summarizeSchema, runSummarize } from "./summarize.server";
import { translateSchema, runTranslate } from "./translate.server";
import { taglinesSchema, runTaglines } from "./taglines.server";
import { speechSchema, runSpeech } from "./speech.server";
import { captionSchema, runCaption } from "./caption.server";
import { workersImageSchema, runWorkersImage } from "./workers-image.server";
import { falImageSchema, runFalImage } from "./fal-image.server";
import { avatarSchema, runAvatar } from "./avatar.server";

export const aiTaskSchema = z.discriminatedUnion("task", [
	webSearchSchema,
	decisionSchema,
	summarizeSchema,
	translateSchema,
	taglinesSchema,
	speechSchema,
	captionSchema,
	workersImageSchema,
	falImageSchema,
	avatarSchema,
]);
export type AiTaskInput = z.infer<typeof aiTaskSchema>;

/** Invoke only after authenticated, same-origin, owner-scoped durable admission. */
export async function runAiTask(
	ai: AiService,
	body: AiTaskInput,
): Promise<Response> {
	switch (body.task) {
		case "web-search":
			return runWebSearch(ai, body);
		case "decision":
			return runDecision(ai, body);
		case "summarize":
			return runSummarize(ai, body);
		case "translate":
			return runTranslate(ai, body);
		case "taglines":
			return runTaglines(ai, body);
		case "speech":
			return runSpeech(ai, body);
		case "caption":
			return runCaption(ai, body);
		case "workers-image":
			return runWorkersImage(ai, body);
		case "fal-image":
			return runFalImage(ai, body);
		case "avatar":
			return runAvatar(ai, body);
	}
}
