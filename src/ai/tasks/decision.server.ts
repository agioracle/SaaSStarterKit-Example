import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { AiService } from "../types";
import { json } from "../../lib/security";
import { DECISION_MODELS } from "../../config/ai-models";

/** Task-specific validation and output encoding; auth/admission/dispatch remain in handleAi. */
export const decisionSchema = z.object({
	task: z.literal("decision"),
	text: z.string().min(10).max(4000),
	model: z.enum(DECISION_MODELS).optional(),
});
export async function runDecision(
	ai: AiService,
	body: z.infer<typeof decisionSchema>,
): Promise<Response> {
	return json(await ai.decide(body));
}
