import type { ElementType } from "react";
/** Icons are decorative; the adjacent localized text supplies the accessible name. */
export function MenuIcon({ icon: Icon }: { icon?: ElementType }) {
	return Icon ? <Icon aria-hidden="true" focusable="false" size={18} /> : null;
}
