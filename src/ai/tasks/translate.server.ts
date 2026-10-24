import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { AiService } from "../types";
import { json } from "../../lib/security";
import { TRANSLATION_LANGUAGES } from "../../config/ai-models";

/** Task-specific validation and output encoding; auth/admission/dispatch remain in handleAi. */
export const translateSchema = z.object({
	task: z.literal("translate"),
	text: z.string().max(5000),
	source: z.enum(TRANSLATION_LANGUAGES),
	target: z.enum(TRANSLATION_LANGUAGES),
});
export async function runTranslate(
	ai: AiService,
	body: z.infer<typeof translateSchema>,
): Promise<Response> {
	return json({ text: await ai.translate(body) });
}
