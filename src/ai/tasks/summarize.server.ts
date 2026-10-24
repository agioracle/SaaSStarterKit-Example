import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { AiService } from "../types";
import { json } from "../../lib/security";

/** Task-specific validation and output encoding; auth/admission/dispatch remain in handleAi. */
export const summarizeSchema = z.object({
	task: z.literal("summarize"),
	text: z.string().min(50).max(500),
});
export async function runSummarize(
	ai: AiService,
	body: z.infer<typeof summarizeSchema>,
): Promise<Response> {
	return json({ text: await ai.summarize(body.text) });
}
