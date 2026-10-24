import type { MenuItemConfig } from '../../config/menu';
import { localePath } from '../../locale';
export function menuHref(item: MenuItemConfig) {
	const href = item.href || "#";
	return href.startsWith("/")
		? localePath(href)
		: /^(https?:\/\/|mailto:|#)/.test(href)
			? href
			: "#";
}
