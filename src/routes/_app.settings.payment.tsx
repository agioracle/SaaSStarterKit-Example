import { createFileRoute } from "@tanstack/react-router";
import { PaymentStatusPage } from "../components/settings/billing";
import type { PaymentProviderId } from "../payment/types";
export const Route = createFileRoute("/_app/settings/payment")({
	validateSearch: (s: Record<string, unknown>) => ({
		provider:
			typeof s.provider === "string" &&
			/^[a-z][a-z0-9-]{0,63}$/.test(s.provider)
				? (s.provider as PaymentProviderId)
				: undefined,
		reference:
			typeof s.reference === "string"
				? s.reference
				: typeof s.session_id === "string"
					? s.session_id
					: typeof s.request_id === "string"
						? s.request_id
						: typeof s.checkout_id === "string"
							? s.checkout_id
							: undefined,
	}),
	component: Page,
});
function Page() {
	const { reference, provider } = Route.useSearch();
	return <PaymentStatusPage reference={reference} provider={provider} />;
}
