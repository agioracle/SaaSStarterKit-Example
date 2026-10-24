import { createPaymentService, type PaymentServiceConfig } from "./service";
import { getProviderRegistration } from "./registry";
import type { PaymentProviderFacade } from "./types";
/** Documented provider-style names over the same authenticated durable engine.
 * This is a compatibility surface, not another webhook implementation. */
export function createPaymentProviderFacade(
	config: PaymentServiceConfig,
): PaymentProviderFacade {
	const service = createPaymentService(config);
	const registration = getProviderRegistration(config.provider.id);
	return {
		requiresCustomerId:
			config.provider.requiresCustomerId ??
			registration.requiresCustomerId ??
			true,
		hostsPostCheckoutPage:
			config.provider.hostsPostCheckoutPage ??
			registration.hostsPostCheckoutPage ??
			false,
		getProviderName: () => config.provider.id,
		createCheckout: ({ user, ...params }) =>
			service.createCheckout(user, params),
		createCustomerPortal: ({ user, returnUrl, reference }) =>
			service.createPortal(user, returnUrl, reference),
		async handleWebhookEvent(payload, signature) {
			await service.handleWebhook(
				payload,
				new Headers({ [registration.webhookSignatureHeader]: signature }),
			);
		},
	};
}
