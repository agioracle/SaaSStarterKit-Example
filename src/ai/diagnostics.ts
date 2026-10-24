/** Client-safe diagnostic identifiers, never raw provider messages or URLs. */
export const AI_PROVIDER_CODES = ["PAYMENT_REQUIRED"] as const;
export const AI_SETUP_HINTS = [
	"CHECK_AI_GATEWAY_FUNDING",
	"CHECK_WORKERS_AI_BILLING",
	"CHECK_FAL_BILLING",
	"CHECK_AI_CONFIGURATION",
] as const;
export type AiProviderCode = (typeof AI_PROVIDER_CODES)[number];
export type AiSetupHint = (typeof AI_SETUP_HINTS)[number];
export interface AiProviderDiagnostic {
	providerCode?: AiProviderCode;
	setupHint?: AiSetupHint;
}

/** Derive diagnostics from our validated task and HTTP status, not upstream text. */
export function aiPaymentDiagnostic(task: string): AiProviderDiagnostic {
	return {
		providerCode: "PAYMENT_REQUIRED",
		setupHint:
			task === "web-search"
				? "CHECK_AI_GATEWAY_FUNDING"
				: task === "fal-image" || task === "avatar"
					? "CHECK_FAL_BILLING"
					: "CHECK_WORKERS_AI_BILLING",
	};
}
