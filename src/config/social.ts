import { m } from "../locale/paraglide/messages";
import { websiteConfig } from "./website";
import { getMailtoUrl } from "../mail/mailbox";

export function getSocialLinks() {
	const supportUrl = getMailtoUrl(
		websiteConfig.mail.supportEmail || websiteConfig.social.supportEmail,
	);
	return [
		...Object.entries(websiteConfig.social)
			.filter(
				([key, value]) => key !== "supportEmail" && /^https:\/\//.test(value),
			)
			.map(([key, href]) => ({
				label: key === "twitter" ? "X" : key === "github" ? "GitHub" : key,
				href,
				external: true,
			})),
		...(supportUrl
			? [
					{
						label: m.config_social_email_us(),
						href: supportUrl,
						external: false,
					},
				]
			: []),
	];
}
