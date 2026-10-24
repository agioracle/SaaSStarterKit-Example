import { Text } from "react-email";
import Button from "./email-button";
import EmailLayout from "./email-layout";

export function ActionEmail({
	title,
	name,
	description,
	url,
	action,
}: {
	title: string;
	name: string;
	description: string;
	url: string;
	action: string;
}) {
	return (
		<EmailLayout title={title}>
			<Text>Hello {name},</Text>
			<Text>{description}</Text>
			<Button
				href={url}
				style={{
					backgroundColor: "#4659e4",
					color: "#fff",
					padding: "12px 20px",
					borderRadius: "6px",
				}}
			>
				{action}
			</Button>
			<Text style={{ fontSize: "12px", wordBreak: "break-all" }}>{url}</Text>
		</EmailLayout>
	);
}
