import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { AiService } from "../types";
import { json } from "../../lib/security";

/** Task-specific validation and output encoding; auth/admission/dispatch remain in handleAi. */
export const taglinesSchema = z.object({
	task: z.literal("taglines"),
	text: z.string().max(500),
});
export async function runTaglines(
	ai: AiService,
	body: z.infer<typeof taglinesSchema>,
): Promise<Response> {
	return json({ taglines: await ai.taglines(body.text) });
}
