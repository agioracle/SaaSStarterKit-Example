import {
	assertPaymentCredentialMode,
	type CredentialMode,
} from "../config/payment-mode";
import { createStripeProvider } from "./providers/stripe";
import { createCreemProvider } from "./providers/creem";
import { createWaffoProvider } from "./providers/waffo";
import {
	PaymentError,
	type PaymentMode,
	type PaymentAdapter,
	type PaymentProviderId,
} from "./types";

type Environment = Record<string, string | undefined>;
export interface ProviderRegistration {
	create(context: { env: Environment; mode: PaymentMode }): PaymentAdapter;
	/** Secret identity material is hashed by namespace.ts and is never public. */
	credentialIdentity(env: Environment): string | undefined;
	credentialMode?(env: Environment, mode: PaymentMode): CredentialMode;
	webhookSignatureHeader: string;
	requiresCustomerId?: boolean;
	hostsPostCheckoutPage?: boolean;
	supportsCheckoutRecovery?: boolean;
	supportsSubscriptionReconciliation?: boolean;
}
/** Server-only, trusted source configuration. Add an adapter and one registry entry.
 * Never populate this registry from request bodies, remote URLs or browser settings. */
export const providerRegistry: Record<PaymentProviderId, ProviderRegistration> =
	{
		stripe: {
			create: ({ env, mode }) =>
				createStripeProvider({
					secretKey: env.STRIPE_SECRET_KEY,
					webhookSecret: env.STRIPE_WEBHOOK_SECRET,
					apiVersion: env.STRIPE_API_VERSION,
					mode,
				}),
			credentialIdentity: (env) => env.STRIPE_SECRET_KEY,
			credentialMode: (env, mode) =>
				assertPaymentCredentialMode(
					"stripe",
					env.STRIPE_SECRET_KEY || "",
					mode,
				),
			webhookSignatureHeader: "stripe-signature",
			supportsCheckoutRecovery: true,
			supportsSubscriptionReconciliation: true,
		},
		creem: {
			create: ({ env, mode }) =>
				createCreemProvider({
					apiKey: env.CREEM_API_KEY,
					webhookSecret: env.CREEM_WEBHOOK_SECRET,
					mode,
				}),
			credentialIdentity: (env) => env.CREEM_API_KEY,
			credentialMode: (env, mode) =>
				assertPaymentCredentialMode("creem", env.CREEM_API_KEY || "", mode),
			webhookSignatureHeader: "creem-signature",
			hostsPostCheckoutPage: true,
			supportsCheckoutRecovery: true,
			supportsSubscriptionReconciliation: true,
		},
		waffo: {
			create: ({ env, mode }) =>
				createWaffoProvider({
					merchantId: env.WAFFO_MERCHANT_ID,
					storeId: env.WAFFO_STORE_ID,
					privateKey: env.WAFFO_PRIVATE_KEY,
					portalSso: env.WAFFO_PORTAL_SSO === "true",
					mode,
				}),
			credentialIdentity: (env) =>
				env.WAFFO_MERCHANT_ID && env.WAFFO_STORE_ID && env.WAFFO_PRIVATE_KEY
					? `${env.WAFFO_MERCHANT_ID}:${env.WAFFO_STORE_ID}:${env.WAFFO_PRIVATE_KEY}`
					: undefined,
			webhookSignatureHeader: "x-waffo-signature",
			requiresCustomerId: false,
			hostsPostCheckoutPage: true,
		},
	};
export function isRegisteredPaymentProvider(
	value: string,
): value is PaymentProviderId {
	return (
		/^[a-z][a-z0-9-]{0,63}$/.test(value) &&
		Object.hasOwn(providerRegistry, value)
	);
}
export function getProviderRegistration(id: string): ProviderRegistration {
	if (!isRegisteredPaymentProvider(id))
		throw new PaymentError(
			"CONFIGURATION",
			"Payment provider is not registered",
		);
	return providerRegistry[id];
}
export function createRegisteredPaymentProvider(
	id: PaymentProviderId,
	env: Environment,
	mode: PaymentMode,
) {
	const registration = getProviderRegistration(id);
	const credentialMode = registration.credentialMode?.(env, mode) ?? "unknown";
	const provider = registration.create({ env, mode });
	if (provider.id !== id)
		throw new PaymentError(
			"CONFIGURATION",
			"Payment provider registration identity mismatch",
		);
	return {
		provider: Object.assign(provider, {
			requiresCustomerId:
				registration.requiresCustomerId ?? provider.requiresCustomerId ?? true,
			hostsPostCheckoutPage:
				registration.hostsPostCheckoutPage ??
				provider.hostsPostCheckoutPage ??
				false,
		}),
		credentialMode,
	};
}
