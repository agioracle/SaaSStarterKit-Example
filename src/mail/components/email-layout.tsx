import {
	Body,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Preview,
	Text,
} from "react-email";
import type { ReactNode } from "react";
import { websiteConfig } from "../../config/website";

/** Shared markup for built-in and custom templates; safe for standalone previews. */
export function EmailLayout({
	title = websiteConfig.name,
	children,
}: {
	title?: string;
	children: ReactNode;
}) {
	return (
		<Html lang="en">
			<Head />
			<Preview>{title}</Preview>
			<Body
				style={{ backgroundColor: "#f6f7fb", fontFamily: "Arial, sans-serif" }}
			>
				<Container
					style={{
						backgroundColor: "#fff",
						padding: "32px",
						maxWidth: "560px",
						borderRadius: "12px",
					}}
				>
					<Heading>{title}</Heading>
					{children}
					<Hr />
					<Text style={{ color: "#667085", fontSize: "12px" }}>
						This is a service message. If you did not request it, you can ignore
						it.
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default EmailLayout;
