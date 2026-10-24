import { getSocialLinks as getLegacySocialLinks } from "./social";
import type { MenuItemConfig } from "./menu";
export { getMailtoUrl } from "../mail/mailbox";
export function getSocialLinks(): MenuItemConfig[] {
	return getLegacySocialLinks().map(({ label, ...item }) => ({
		...item,
		title: label,
	}));
}
