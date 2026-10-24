import { ActionEmail } from "../components/action-email";
import type { EmailTemplateContexts } from "../types";

export default function SubscribeNewsletterEmail(
	props: EmailTemplateContexts["subscribeNewsletter"],
) {
	return (
		<ActionEmail
			{...props}
			title="Confirm your newsletter subscription"
			description="Confirm that you would like to receive our newsletter."
			action="Confirm subscription"
		/>
	);
}

SubscribeNewsletterEmail.PreviewProps = {
	name: "Preview Reader",
	url: "https://example.invalid/preview-only",
} satisfies EmailTemplateContexts["subscribeNewsletter"];
