import { m } from "../locale/paraglide/messages";
export function getFooterLinks() {
	return [
		{
			title: m.lumina_nav_create(),
			items: [
				{ href: "/studio", label: m.lumina_nav_studio() },
				{ href: "/library", label: m.lumina_nav_my_library() },
				{ href: "/pricing", label: m.lumina_nav_plans_pricing() },
			],
		},
		{
			title: m.lumina_nav_your_space(),
			items: [
				{ href: "/settings/profile", label: m.lumina_nav_account() },
				{ href: "/settings/security", label: m.lumina_nav_security() },
				{ href: "/contact", label: m.lumina_nav_contact() },
			],
		},
		{
			title: m.lumina_nav_the_details(),
			items: [
				{ href: "/privacy", label: m.lumina_nav_privacy() },
				{ href: "/terms", label: m.lumina_nav_terms() },
				{ href: "/cookie", label: m.lumina_nav_cookies() },
			],
		},
	];
}
