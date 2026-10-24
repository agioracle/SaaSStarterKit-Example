import { z } from "zod";
import { ASPECT_RATIOS, MODEL_IDS } from "./types";
export const generationInputSchema = z
	.object({
		model: z.enum(MODEL_IDS),
		prompt: z.string().trim().min(1).max(2000),
		aspectRatio: z.enum(ASPECT_RATIOS),
		seed: z.number().int().min(0).max(2147483647).optional(),
		idempotencyKey: z.uuid(),
	})
	.strict()
	.superRefine((input, ctx) => {
		if (
			input.model === "workers-flux-schnell" &&
			(input.aspectRatio !== "1:1" || input.seed !== undefined)
		)
			ctx.addIssue({
				code: "custom",
				message: "Workers FLUX supports square images without a seed setting.",
			});
	});
export function utcPeriod(now = Date.now()) {
	return new Date(now).toISOString().slice(0, 7);
}
