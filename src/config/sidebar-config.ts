import { getSidebarLinks as getLegacySidebarLinks } from "./sidebar";
import type { MenuItemConfig } from "./menu";
/** Role metadata is presentation only. The API still enforces authentication and authorization. */
export function getSidebarLinks(): MenuItemConfig[] {
	return getLegacySidebarLinks("admin").map(({ to, label, ...item }) => ({
		...item,
		href: to,
		title: label,
		...(to.startsWith("/admin/") ? { authorizeOnly: ["admin"] } : {}),
	}));
}
