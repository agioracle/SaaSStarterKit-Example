import { getLocale } from "../../locale";
import { productMessages, type ProductMessageKey } from "./messages";
/** Resolve per render, not at module initialization, for request-safe SSR. */
export function l(key: ProductMessageKey, locale = getLocale()) {
	return productMessages[locale.startsWith("zh") ? "zh" : "en"][key];
}
export function promptText(index: number) {
	return (
		[
			l(
				"an_architectural_still_life_of_warm_terracotta_arches_pale_sand_soft_a",
			),
			l(
				"a_sculptural_glass_vase_with_a_single_wildflower_natural_shadows_cream",
			),
			l(
				"an_imaginary_coastal_landscape_floating_coral_shapes_muted_sage_green_",
			),
		][index] || ""
	);
}
