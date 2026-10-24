import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { AiService } from "../types";
import { SPEECH_VOICES } from "../../config/ai-models";

/** Task-specific validation and output encoding; auth/admission/dispatch remain in handleAi. */
export const speechSchema = z.object({
	task: z.literal("speech"),
	text: z.string().max(2000),
	voice: z.enum(SPEECH_VOICES).optional(),
});
export async function runSpeech(
	ai: AiService,
	body: z.infer<typeof speechSchema>,
): Promise<Response> {
	const audio = await ai.speak(body);
	return new Response(audio.bytes as BodyInit, {
		headers: { "content-type": audio.contentType, "cache-control": "no-store" },
	});
}
