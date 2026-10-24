/** Compile-only regression. The public void webhook contract must not become a
 * substitute for verified, normalized ledger facts in a trusted registration. */
import type { ProviderRegistration } from "../src/payment/registry";
import type {
	PaymentAdapter,
	PaymentProvider,
	PaymentProviderFacade,
} from "../src/payment/types";
export function assertPaymentContractBoundary(provider: PaymentProvider) {
	const publicAlias: PaymentProviderFacade = provider;
	// @ts-expect-error A public provider lacks the signed-fact adapter contract.
	const incompleteAdapter: PaymentAdapter = provider;
	// @ts-expect-error Registering a public void handler is not normalized ledger admission.
	const incompleteFactory: ProviderRegistration["create"] = () => provider;
	return { publicAlias, incompleteAdapter, incompleteFactory };
}
