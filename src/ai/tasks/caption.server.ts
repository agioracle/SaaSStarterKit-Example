import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { AiService } from "../types";
import { json } from "../../lib/security";

/** Task-specific validation and output encoding; auth/admission/dispatch remain in handleAi. */
export const captionSchema = z.object({
	task: z.literal("caption"),
	image: z.string().max(7_000_000),
	prompt: z.string().max(1000).optional(),
});
export async function runCaption(
	ai: AiService,
	body: z.infer<typeof captionSchema>,
): Promise<Response> {
	return json({ text: await ai.caption(body) });
}
