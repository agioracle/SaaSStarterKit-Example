import type { Locale } from "../locale";

/** Public runtime locale entrypoint. Build tools use config/locale-settings instead. */
export { getLocale, localePath, localizeUrl, deLocalizeUrl, locales, baseLocale, isLocale, safeReturnPath, type Locale } from '../locale';
export { localeSettings } from '../config/locale-settings';

export type LocaleConfig = {
	name: string;
	hreflang: string;
	flag?: string;
};

/** Edit names, optional flags and SEO language tags here, not in generated code. */
export const localeConfig: Record<string, LocaleConfig> = {
	en: { name: "English", flag: "🇺🇸", hreflang: "en-US" },
	zh: { name: "简体中文", flag: "🇨🇳", hreflang: "zh-CN" },
} satisfies Record<Locale, LocaleConfig>;

export function getLocaleName(locale: string) {
	if (localeConfig[locale]) return localeConfig[locale].name;
	try {
		return new Intl.DisplayNames([locale], { type: "language" }).of(locale) || locale;
	} catch {
		return locale;
	}
}

/**
 * Fully translated static routes, without locale prefixes, queries or trailing slashes.
 * Add a route only after every configured locale is available. Blog/legal content
 * supplies its actual translations to seo() instead of being listed here.
 */
export const LOCALIZED_PATHS = new Set<string>([
	"/",
	"/about",
	"/contact",
	"/changelog",
	"/roadmap",
	"/ai",
	"/waitlist",
	"/pricing",
	"/blog",
]);
