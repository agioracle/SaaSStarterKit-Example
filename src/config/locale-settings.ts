import project from "../../project.inlang/settings.json";

/**
 * Pure build-time inventory shared by Vite, content and maintenance scripts.
 * Do not import the public runtime entrypoint here: generated Paraglide files do
 * not exist yet in a fresh checkout. Display/SEO overrides live in lib/locale.ts.
 */
export const localeSettings = {
	baseLocale: project.baseLocale,
	locales: project.locales,
};
export function createLocaleUrlPatterns(settings = localeSettings) {
	return [
		{
			pattern: "/:path(.*)?",
			// The unprefixed catch-all must come last, after every explicit locale prefix.
			localized: [
				...settings.locales
					.filter((locale) => locale !== settings.baseLocale)
					.map((locale): [string, string] => [locale, `/${locale}/:path(.*)?`]),
				[settings.baseLocale, "/:path(.*)?"] as [string, string],
			],
		},
	];
}
export const localeUrlPatterns = createLocaleUrlPatterns();
