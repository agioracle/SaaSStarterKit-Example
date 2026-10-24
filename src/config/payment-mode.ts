import { HttpError } from "../lib/security";
export type CredentialMode = "test" | "live" | "unknown";
/** Only recognized provider prefixes establish key mode. Waffo keys are opaque. */
export function paymentCredentialMode(
	provider: string,
	key: string,
): CredentialMode {
	if (provider === "stripe") {
		if (/^[sr]k_test_/.test(key)) return "test";
		if (/^[sr]k_live_/.test(key)) return "live";
	}
	if (provider === "creem") {
		if (key.startsWith("creem_test_")) return "test";
		if (key.startsWith("creem_live_")) return "live";
	}
	return "unknown";
}
export function assertPaymentCredentialMode(
	provider: string,
	key: string,
	mode: "test" | "live",
) {
	const credentialMode = paymentCredentialMode(provider, key);
	if (
		(provider === "stripe" || provider === "creem") &&
		(credentialMode === "unknown" || credentialMode !== mode)
	)
		throw new HttpError(
			503,
			"Payment credentials are missing or do not match the configured mode.",
		);
	return credentialMode;
}
