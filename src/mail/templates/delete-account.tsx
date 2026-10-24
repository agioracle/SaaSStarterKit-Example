import { ActionEmail } from "../components/action-email";
import type { EmailTemplateContexts } from "../types";

export default function DeleteAccountEmail(
	props: EmailTemplateContexts["deleteAccount"],
) {
	return (
		<ActionEmail
			{...props}
			title="Confirm account deletion"
			description="You requested to delete your account. Continue only if you want to permanently delete it."
			action="Confirm deletion"
		/>
	);
}

DeleteAccountEmail.PreviewProps = {
	name: "Preview Reader",
	url: "https://example.invalid/preview-only",
} satisfies EmailTemplateContexts["deleteAccount"];
