import {
	bearer,
	emailInput,
	record,
	requestJson,
	requiredConfig,
	ServiceError,
	stringField,
	type FetchTransport,
} from "../../ai/http.server";
import type { NewsletterProvider } from "../types";
export function resendNewsletter(
	apiKey: string,
	transport: FetchTransport,
): NewsletterProvider {
	const headers = bearer(requiredConfig(apiKey, "RESEND_API_KEY"));
	const base = "https://api.resend.com/contacts";
	async function find(email: string) {
		try {
			const result = record(
				await requestJson(transport, `${base}/${encodeURIComponent(email)}`, {
					method: "GET",
					headers,
				}),
			);
			if (typeof result.unsubscribed !== "boolean")
				throw new ServiceError(
					"UPSTREAM",
					"Resend returned an invalid contact status",
				);
			return result;
		} catch (error) {
			if (error instanceof ServiceError && error.status === 404) return null;
			throw error;
		}
	}
	return {
		getProviderName: () => "resend",
		async subscribe(input) {
			const email = emailInput(input.email);
			if (input.consent !== true)
				throw new ServiceError(
					"VALIDATION",
					"Explicit newsletter consent is required",
				);
			const existing = await find(email);
			if (existing?.unsubscribed === false) return true;
			if (existing && !input.resubscribe) return false;
			const result = await requestJson(
				transport,
				existing ? `${base}/${encodeURIComponent(email)}` : base,
				{
					method: existing ? "PATCH" : "POST",
					headers,
					json: existing
						? { unsubscribed: false }
						: { email, unsubscribed: false },
				},
			);
			stringField(record(result).id);
			return true;
		},
		async unsubscribe(input) {
			const email = emailInput(input.email);
			try {
				stringField(
					record(
						await requestJson(
							transport,
							`${base}/${encodeURIComponent(email)}`,
							{ method: "PATCH", headers, json: { unsubscribed: true } },
						),
					).id,
				);
			} catch (error) {
				if (!(error instanceof ServiceError && error.status === 404))
					throw error;
			}
			return true;
		},
		async checkSubscribeStatus(input) {
			const contact = await find(emailInput(input.email));
			return contact?.unsubscribed === false;
		},
	};
}
