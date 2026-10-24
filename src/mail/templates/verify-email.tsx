import { ActionEmail } from "../components/action-email";
import type { EmailTemplateContexts } from "../types";

export default function VerifyEmail(
	props: EmailTemplateContexts["verifyEmail"],
) {
	return (
		<ActionEmail
			{...props}
			title="Verify your email address"
			description="Confirm that this email address belongs to you."
			action="Verify email"
		/>
	);
}

VerifyEmail.PreviewProps = {
	name: "Preview Reader",
	url: "https://example.invalid/preview-only",
} satisfies EmailTemplateContexts["verifyEmail"];
