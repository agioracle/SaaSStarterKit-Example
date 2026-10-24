import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { AiService } from "../types";
import { json } from "../../lib/security";
import { WORKERS_IMAGE_MODELS } from "../../config/ai-models";

/** Task-specific validation and output encoding; auth/admission/dispatch remain in handleAi. */
export const workersImageSchema = z.object({
	task: z.literal("workers-image"),
	prompt: z.string().max(2000),
	model: z.enum(WORKERS_IMAGE_MODELS).optional(),
	width: z.number().optional(),
	height: z.number().optional(),
});
export async function runWorkersImage(
	ai: AiService,
	body: z.infer<typeof workersImageSchema>,
): Promise<Response> {
	return json(await ai.generateWorkersImage(body));
}
