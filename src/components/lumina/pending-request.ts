import { generationInputSchema } from "../../generation/validation";
import type { GenerationInput } from "../../generation/types";
export const pendingRequestKey = (userId: string) =>
	`lumina:pending-generation:${userId}`;
export function readPendingRequest(
	storage: Pick<Storage, "getItem">,
	userId: string,
): GenerationInput | null {
	const value = storage.getItem(pendingRequestKey(userId));
	if (!value) return null;
	const parsed: unknown = JSON.parse(value);
	if (
		!parsed ||
		typeof parsed !== "object" ||
		!("userId" in parsed) ||
		parsed.userId !== userId ||
		!("input" in parsed)
	)
		throw new Error("Invalid saved request");
	return generationInputSchema.parse(parsed.input);
}
export function savePendingRequest(
	storage: Pick<Storage, "setItem">,
	userId: string,
	input: GenerationInput,
) {
	storage.setItem(
		pendingRequestKey(userId),
		JSON.stringify({ userId, input: generationInputSchema.parse(input) }),
	);
}
export function clearPendingRequest(
	storage: Pick<Storage, "removeItem">,
	userId: string,
) {
	storage.removeItem(pendingRequestKey(userId));
}
