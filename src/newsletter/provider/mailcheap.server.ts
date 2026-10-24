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
export function mailcheapNewsletter(
	config: { apiKey: string; newsletterId: string },
	transport: FetchTransport,
): NewsletterProvider {
	const headers = bearer(
		requiredConfig(config.apiKey, "MAILCHEAP_API_KEY (Full access key)"),
	);
	const newsletter = requiredConfig(
		config.newsletterId,
		"MAILCHEAP_NEWSLETTER_ID",
	);
	if (newsletter.length > 100)
		throw new ServiceError(
			"CONFIGURATION",
			"MailCheap newsletter identifier is too long",
		);
	const base = "https://mailcheap.ai/api/v1/contacts";
	return {
		getProviderName: () => "mailcheap",
		async subscribe(input) {
			if (input.consent !== true)
				throw new ServiceError(
					"VALIDATION",
					"Explicit newsletter consent is required",
				);
			const result = record(
				await requestJson(transport, base, {
					headers,
					json: {
						email: emailInput(input.email),
						newsletter,
						source: "website",
						resubscribe: input.resubscribe === true,
					},
				}),
			);
			stringField(result.id);
			return ["active", "pending"].includes(stringField(result.status));
		},
		async unsubscribe(input) {
			try {
				const result = record(
					await requestJson(
						transport,
						`${base}/${encodeURIComponent(emailInput(input.email))}`,
						{
							method: "PATCH",
							headers,
							json: { newsletter, status: "unsubscribed" },
						},
					),
				);
				return stringField(result.status) === "unsubscribed";
			} catch (error) {
				if (error instanceof ServiceError && error.status === 404) return true;
				throw error;
			}
		},
		async checkSubscribeStatus(input) {
			try {
				const result = record(
					await requestJson(
						transport,
						`${base}/${encodeURIComponent(emailInput(input.email))}?${new URLSearchParams({ newsletter })}`,
						{ method: "GET", headers },
					),
				);
				return stringField(result.status) === "active";
			} catch (error) {
				if (error instanceof ServiceError && error.status === 404) return false;
				throw error;
			}
		},
	};
}
