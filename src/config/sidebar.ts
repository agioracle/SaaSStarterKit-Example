import {
	Sparkles,
	Images,
	Activity,
	UserRound,
	ShieldCheck,
	KeyRound,
	Folder,
	CreditCard,
	Bell,
	Users,
} from "lucide-react";
import { websiteConfig } from "./website";
import { m } from "../locale/paraglide/messages";

export function getSidebarLinks(role?: string | null) {
	return [
		{ to: "/studio", label: m.lumina_nav_studio(), icon: Sparkles },
		{ to: "/library", label: m.lumina_nav_my_library(), icon: Images },
		{ to: "/settings/profile", label: m.settings_profile(), icon: UserRound },
		{
			to: "/settings/security",
			label: m.settings_security(),
			icon: ShieldCheck,
		},
		{ to: "/settings/apikeys", label: m.settings_apikeys(), icon: KeyRound },
		...(websiteConfig.storage.enabled
			? [{ to: "/settings/files", label: m.settings_files(), icon: Folder }]
			: []),
		...(websiteConfig.payment.enabled
			? [
					{
						to: "/settings/billing",
						label: m.settings_billing(),
						icon: CreditCard,
					},
				]
			: []),
		...(websiteConfig.newsletter.enabled
			? [
					{
						to: "/settings/notifications",
						label: m.settings_notifications(),
						icon: Bell,
					},
				]
			: []),
		...(role === "admin"
			? [
					{ to: "/admin/users", label: m.config_sidebar_users(), icon: Users },
					{
						to: "/admin/generations",
						label: m.lumina_nav_generation_operations(),
						icon: Activity,
					},
				]
			: []),
	];
}
