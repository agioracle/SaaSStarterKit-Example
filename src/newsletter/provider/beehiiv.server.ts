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
export function beehiivNewsletter(
	config: { apiKey: string; publicationId: string },
	transport: FetchTransport,
): NewsletterProvider {
	const headers = bearer(requiredConfig(config.apiKey, "BEEHIIV_API_KEY"));
	const publication = requiredConfig(
		config.publicationId,
		"BEEHIIV_PUBLICATION_ID",
	);
	if (!/^pub_[\da-f-]+$/i.test(publication))
		throw new ServiceError(
			"CONFIGURATION",
			"Invalid Beehiiv publication identifier",
		);
	const base = `https://api.beehiiv.com/v2/publications/${publication}/subscriptions`;
	async function find(email: string) {
		try {
			return record(
				record(
					await requestJson(
						transport,
						`${base}/by_email/${encodeURIComponent(email)}`,
						{ method: "GET", headers },
					),
				).data,
			);
		} catch (error) {
			if (error instanceof ServiceError && error.status === 404) return null;
			throw error;
		}
	}
	return {
		getProviderName: () => "beehiiv",
		async subscribe(input) {
			if (input.consent !== true)
				throw new ServiceError(
					"VALIDATION",
					"Explicit newsletter consent is required",
				);
			const result = record(
				record(
					await requestJson(transport, base, {
						headers,
						json: {
							email: emailInput(input.email),
							reactivate_existing: input.resubscribe === true,
							send_welcome_email: false,
							double_opt_override: "not_set",
						},
					}),
				).data,
			);
			stringField(result.id);
			return ["active", "validating", "pending"].includes(
				stringField(result.status),
			);
		},
		async unsubscribe(input) {
			// Unsubscribe, never DELETE: deletion destroys the subscriber's history.
			try {
				const result = record(
					record(
						await requestJson(
							transport,
							`${base}/by_email/${encodeURIComponent(emailInput(input.email))}`,
							{ method: "PUT", headers, json: { unsubscribe: true } },
						),
					).data,
				);
				stringField(result.id);
			} catch (error) {
				if (!(error instanceof ServiceError && error.status === 404))
					throw error;
			}
			return true;
		},
		async checkSubscribeStatus(input) {
			const existing = await find(emailInput(input.email));
			if (!existing) return false;
			return stringField(existing.status) === "active";
		},
	};
}
