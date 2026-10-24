import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { AiService } from "../types";
import { json } from "../../lib/security";

/** Task-specific validation and output encoding; auth/admission/dispatch remain in handleAi. */
export const avatarSchema = z.object({
	task: z.literal("avatar"),
	image: z.string().max(7_000_000),
	prompt: z.string().max(2000),
});
export async function runAvatar(
	ai: AiService,
	body: z.infer<typeof avatarSchema>,
): Promise<Response> {
	return json(await ai.editAvatar(body));
}
