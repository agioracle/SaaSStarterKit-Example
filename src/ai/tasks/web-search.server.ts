import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { AiService } from "../types";
import { json } from "../../lib/security";
import { SEARCH_PROVIDERS } from "../../config/ai-models";

/** Task-specific validation and output encoding; auth/admission/dispatch remain in handleAi. */
export const webSearchSchema = z.object({
	task: z.literal("web-search"),
	query: z.string().min(1).max(1024),
	provider: z.enum(SEARCH_PROVIDERS).optional(),
});
export async function runWebSearch(
	ai: AiService,
	body: z.infer<typeof webSearchSchema>,
): Promise<Response> {
	return json(await ai.webSearch(body));
}
