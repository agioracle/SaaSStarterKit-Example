import type { ElementType } from "react";
import { m } from "../locale/paraglide/messages";
export interface MenuItemConfig {
	title: string;
	description?: string;
	icon?: ElementType;
	href?: string;
	external?: boolean;
	authorizeOnly?: readonly string[] | "admin" | "user";
	items?: MenuItemConfig[];
}
export function getNavigation(): MenuItemConfig[] {
	return [
		{ title: "Studio", href: "/studio" },
		{ title: "How it works", href: "/#how-it-works" },
		{ title: "Pricing", href: "/pricing" },
	];
}
export const navigation = getNavigation();

/** Resolve labels per render, never at module scope, for request-safe SSR locales. */
export function getMenuTitle(title: string) {
	if (title === "Studio") return m.lumina_nav_studio();
	if (title === "How it works") return m.lumina_nav_how_it_works();
	const labels: Record<string, () => string> = {
		Features: m.nav_features,
		Pricing: m.nav_pricing,
		Journal: m.nav_blog,
		"AI Studio": m.nav_ai,
		Dashboard: m.nav_dashboard,
	};
	return labels[title]?.() || title;
}
export function isMenuItemVisible(item: MenuItemConfig, role?: string) {
	if (!item.authorizeOnly) return true;
	if (typeof item.authorizeOnly === "string")
		return item.authorizeOnly === "user" ? !!role : role === "admin";
	return Boolean(role && item.authorizeOnly.includes(role));
}
