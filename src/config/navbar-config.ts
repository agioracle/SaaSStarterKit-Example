import { getNavigation, getMenuTitle, type MenuItemConfig } from "./menu";
export type { MenuItemConfig } from "./menu";
/** Render-time localization and feature gates, backed by the existing menu source. */
export function getNavbarLinks(): MenuItemConfig[] {
	return getNavigation().map((item) => ({
		...item,
		title: getMenuTitle(item.title),
	}));
}
