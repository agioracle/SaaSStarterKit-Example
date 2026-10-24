import { ActionEmail } from "../components/action-email";
import type { EmailTemplateContexts } from "../types";

export default function ForgotPasswordEmail(
	props: EmailTemplateContexts["forgotPassword"],
) {
	return (
		<ActionEmail
			{...props}
			title="Reset your password"
			description="Use this secure link to choose a new password."
			action="Reset password"
		/>
	);
}

ForgotPasswordEmail.PreviewProps = {
	name: "Preview Reader",
	url: "https://example.invalid/preview-only",
} satisfies EmailTemplateContexts["forgotPassword"];
