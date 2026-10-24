import { getAvatarLinks as getLegacyAvatarLinks } from "./avatar";
import type { MenuItemConfig } from "./menu";
export function getAvatarLinks(): MenuItemConfig[] {
	return getLegacyAvatarLinks().map(({ label, ...item }) => ({
		...item,
		title: label,
	}));
}
