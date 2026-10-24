import { getFooterLinks as getLegacyFooterLinks } from "./footer";
import type { MenuItemConfig } from "./menu";
export function getFooterLinks(): MenuItemConfig[] {
	return getLegacyFooterLinks().map((group) => ({
		title: group.title,
		items: group.items.map(({ label, ...item }) => ({ ...item, title: label })),
	}));
}
