/** Client state contains only an opaque request ID/outcome, never prompt or output. */
export type AiClientOutcome =
	| "pending"
	| "unknown"
	| "succeeded"
	| "released"
	| "not_started";
export interface AiClientRequest {
	requestId: string;
	outcome: AiClientOutcome;
}
const outcomes: readonly string[] = [
	"pending",
	"unknown",
	"succeeded",
	"released",
	"not_started",
];
export function aiClientOutcome(value: unknown): AiClientOutcome {
	return typeof value === "string" && outcomes.includes(value)
		? (value as AiClientOutcome)
		: "unknown";
}
const storageKey = (userId: string) => `edgekit.ai.request:${userId}`;
export function readAiClientRequest(
	storage: Pick<Storage, "getItem">,
	userId: string,
): AiClientRequest | null {
	const saved = storage.getItem(storageKey(userId));
	if (!saved) return null;
	const value = JSON.parse(saved) as Partial<AiClientRequest>;
	if (
		typeof value.requestId !== "string" ||
		!/^[A-Za-z0-9_-]{16,128}$/.test(value.requestId)
	)
		throw new Error("Stored AI request reference is invalid.");
	// A browser interruption is not cancellation; status must be checked server-side.
	return {
		requestId: value.requestId,
		outcome:
			value.outcome === "pending" ? "unknown" : aiClientOutcome(value.outcome),
	};
}
export function saveAiClientRequest(
	storage: Pick<Storage, "setItem" | "removeItem">,
	userId: string,
	request: AiClientRequest | null,
) {
	if (request) storage.setItem(storageKey(userId), JSON.stringify(request));
	else storage.removeItem(storageKey(userId));
}
