import { getProviderRegistration } from "./registry";
import {
	PaymentError,
	type PaymentMode,
	type PaymentProviderId,
} from "./types";
export function paymentMode(value: string | undefined): PaymentMode {
	if (value === undefined) return "test" as const;
	if (value !== "test" && value !== "live")
		throw new PaymentError(
			"CONFIGURATION",
			"PAYMENT_MODE must be test or live",
		);
	return value;
}
/** Credential identity is pinned, not logged. Key rotation is deliberately an explicit
 * reviewed rebind rather than silently accepting a different merchant in the same D1. */
export async function paymentNamespaceIdentity(
	values: Record<string, string | undefined>,
	provider: PaymentProviderId,
) {
	const mode = paymentMode(values.PAYMENT_MODE);
	const deployment =
		values.PAYMENT_NAMESPACE ||
		new URL(values.APP_URL || "http://localhost:3000").origin;
	const identity = getProviderRegistration(provider).credentialIdentity(values);
	if (!identity)
		throw new PaymentError(
			"CONFIGURATION",
			"Missing payment namespace credentials",
		);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(identity),
	);
	const account = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return { mode, account, deployment };
}
