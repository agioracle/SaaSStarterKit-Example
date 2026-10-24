import { m } from "../locale/paraglide/messages";

export interface NewsletterMutationResult {
	accepted: boolean;
	subscribed: boolean;
}

/** A successful HTTP request is not proof that the provider changed subscription state. */
export function newsletterOutcome(
	response: NewsletterMutationResult,
	subscribe: boolean,
) {
	if (
		!response ||
		typeof response.accepted !== "boolean" ||
		typeof response.subscribed !== "boolean"
	) {
		return {
			confirmed: false,
			kind: "error" as const,
			message:
				m.newsletter_outcome_subscription_status_could_not_be_verified_please(),
		};
	}
	if (response.subscribed === subscribe) {
		return {
			confirmed: true,
			kind: "success" as const,
			message: subscribe
				? m.newsletter_outcome_you_are_subscribed_you_can_change_this()
				: m.newsletter_outcome_you_have_been_unsubscribed(),
		};
	}
	if (!response.accepted) {
		return {
			confirmed: false,
			kind: "error" as const,
			message: subscribe
				? m.newsletter_outcome_the_subscription_request_was_not_accepted_if()
				: m.newsletter_outcome_the_unsubscribe_request_was_not_accepted_you(),
		};
	}
	return {
		confirmed: false,
		kind: "info" as const,
		message: subscribe
			? m.newsletter_outcome_the_request_was_accepted_but_your_subscription()
			: m.newsletter_outcome_the_request_was_accepted_but_you_are(),
	};
}
