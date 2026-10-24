import { Text } from "react-email";
import EmailLayout from "../components/email-layout";
import type { EmailTemplateContexts } from "../types";

export default function ContactMessageEmail({
	name,
	email,
	message,
}: EmailTemplateContexts["contactMessage"]) {
	return (
		<EmailLayout title="New contact message">
			<Text>
				From: {name} ({email})
			</Text>
			<Text style={{ whiteSpace: "pre-wrap" }}>{message}</Text>
		</EmailLayout>
	);
}

ContactMessageEmail.PreviewProps = {
	name: "Preview Reader",
	email: "reader@example.invalid",
	message: "This is a local preview. No email is sent.",
} satisfies EmailTemplateContexts["contactMessage"];
