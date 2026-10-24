import { l } from "./copy";
/** Only known server-safe messages are rendered; provider internals are never surfaced. */
export function productError(message: string | null | undefined) {
	if (!message) return "";
	const known: Record<string, () => string> = {
		"The AI daily safety budget or global concurrency limit has been reached. No provider call was made.":
			() => l("safety_limit"),
		"AI is disabled or its safety budget is invalid.": () => l("safety_limit"),
		"The provider outcome is uncertain. This credit remains reserved; do not submit a duplicate. Contact support if recovery does not resolve it.":
			() =>
				l(
					"the_provider_outcome_is_uncertain_this_credit_remains_reserved_do_not_",
				),
		"The provider rejected this request. No credit was charged. Review your prompt or ask the site owner to check provider configuration.":
			() =>
				l(
					"the_provider_rejected_this_request_no_credit_was_charged_review_your_p",
				),
		"The provider confirmed this generation failed. Your credit was released.":
			() =>
				l(
					"the_provider_confirmed_this_generation_failed_your_credit_was_released",
				),
		"The provider safety check blocked this output after generation. One credit was consumed, and no image is available.":
			() =>
				l(
					"the_provider_safety_check_blocked_this_output_after_generation_one_cre",
				),
		"The generated result could not yet be saved. Recovery only retrieves the existing result and never creates another image.":
			() =>
				l(
					"the_generated_result_could_not_yet_be_saved_recovery_only_retrieves_th",
				),
		"Support confirmed this request consumed a credit. The image is unavailable; no automatic retry was made.":
			() =>
				l(
					"support_confirmed_this_request_consumed_a_credit_the_image_is_unavaila",
				),
		"Support confirmed this request did not consume a credit and released the reservation.":
			() =>
				l(
					"support_confirmed_this_request_did_not_consume_a_credit_and_released_t",
				),
		"The site owner must configure this model provider before generation is available.":
			() =>
				l(
					"the_site_owner_must_configure_this_model_provider_before_generation_is",
				),
		"Image generation is not enabled. The site owner must configure D1, private R2, model credentials, and IMAGE_GENERATION_ENABLED.":
			() =>
				l(
					"image_generation_is_not_enabled_ask_your_operator_to_configure_storage",
				),
		"Image storage requires the latest database migrations. Contact the site owner.":
			() =>
				l(
					"image_storage_requires_the_latest_database_migrations_contact_the_site",
				),
		"Image request not found.": () => l("image_request_not_found"),
		"Image not available.": () => l("image_not_available"),
		"The image quota configuration is invalid. Contact the site owner.": () =>
			l("the_image_quota_configuration_is_invalid_contact_the_site_owner"),
		"Your UTC-month image quota is exhausted. Upgrade your plan or wait for the next month.":
			() =>
				l(
					"your_utc_month_image_quota_is_exhausted_review_your_plan_or_wait_for_t",
				),
		"Your active image request limit is reached. Wait for existing requests or resolve uncertain requests with support.":
			() =>
				l(
					"your_active_image_request_limit_is_reached_wait_for_existing_requests_",
				),
		"Your retained image limit is reached. Delete images before generating more.":
			() =>
				l(
					"your_retained_image_limit_is_reached_delete_images_before_generating_m",
				),
		"An active or uncertain generation cannot be deleted. Recover it or contact support first.":
			() =>
				l(
					"an_active_or_uncertain_generation_cannot_be_deleted_recover_it_or_cont",
				),
		"Image storage is unavailable. Ask the site owner to restore the private R2 binding.":
			() =>
				l(
					"image_storage_is_unavailable_ask_the_site_owner_to_restore_the_private",
				),
		"Account deletion is in progress.": () =>
			l("account_deletion_is_in_progress"),
	};
	return (
		known[message]?.() ||
		l("the_request_could_not_be_completed_check_your_connection_sign_in_again")
	);
}
