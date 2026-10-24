import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { AiService } from "../types";
import { json } from "../../lib/security";
import { FAL_IMAGE_MODELS } from "../../config/ai-models";

/** Task-specific validation and output encoding; auth/admission/dispatch remain in handleAi. */
export const falImageSchema = z.object({
	task: z.literal("fal-image"),
	prompt: z.string().max(2000),
	model: z.enum(FAL_IMAGE_MODELS).optional(),
});
export async function runFalImage(
	ai: AiService,
	body: z.infer<typeof falImageSchema>,
): Promise<Response> {
	return json(await ai.generateFalImage(body));
}
