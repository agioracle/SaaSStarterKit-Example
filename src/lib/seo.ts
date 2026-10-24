import { jsonLdScript, publicPageGraph } from "./structured-data";
export { jsonLd } from "./structured-data";
import { m } from "../locale/paraglide/messages";

import { localeConfig, LOCALIZED_PATHS } from "./locale";
import { websiteConfig } from "../config/website";
import { getLocalizedMetadata } from "../config/metadata";
import {
	getLocale,
	localePath,
	locales,
	baseLocale,
	isLocale,
	type Locale,
} from "../locale";
export function seo(
	path: string,
	options: {
		title?: string;
		description?: string;
		image?: string;
		noIndex?: boolean;
		alternateLocales?: Locale[];
		canonicalLocale?: Locale;
		type?: string;
		keywords?: string;
		imageWidth?: number;
		imageHeight?: number;
	},
) {
	const locale = getLocale();
  const segments = new URL(path, websiteConfig.url).pathname.split('/');
  if ((locales as readonly string[]).includes(segments[1])) segments.splice(1, 1);
  const routePath = segments.join('/').replace(/\/+$/, '') || '/';
  const noIndex = options.noIndex || /^\/(?:auth|settings|admin|dashboard|studio|library|api)(?:\/|$)/.test(routePath);
	const alternateLocales = noIndex
		? []
		: [...new Set(options.alternateLocales ?? (LOCALIZED_PATHS.has(routePath) ? locales : []))].filter(isLocale);
	// Never invent a base-language translation for content available elsewhere only.
	const defaultLocale = alternateLocales.includes(baseLocale)
		? baseLocale
		: options.canonicalLocale && alternateLocales.includes(options.canonicalLocale)
			? options.canonicalLocale
			: alternateLocales[0];
	const metadata = getLocalizedMetadata(locale);
	const url = new URL(
		localePath(path, options.canonicalLocale ?? locale),
		metadata.siteUrl,
	).href;
	const titleTranslations: Record<string, string> = {
		Pricing: m.lib_seo_pricing({}, { locale }),
		Journal: m.lib_seo_journal({}, { locale }),
		About: m.lib_seo_about({}, { locale }),
		Contact: m.lib_seo_contact({}, { locale }),
		Changelog: m.lib_seo_changelog({}, { locale }),
		Roadmap: m.lib_seo_roadmap({}, { locale }),
		"AI studio": m.lib_seo_ai_studio({}, { locale }),
		"Stay in the loop": m.lib_seo_stay_in_the_loop({}, { locale }),
		"Sign in": m.lib_seo_sign_in({}, { locale }),
		"Create account": m.lib_seo_create_account({}, { locale }),
		"Reset your password": m.lib_seo_reset_your_password({}, { locale }),
		"Choose a new password": m.lib_seo_choose_a_new_password({}, { locale }),
		"Authentication error": m.lib_seo_authentication_error({}, { locale }),
	};
	const title = options.title
		? `${titleTranslations[options.title] ?? options.title} · ${metadata.name}`
		: metadata.title;
	const image = options.image ?? metadata.image;
	const description = options.description ?? metadata.description;
  const bundledRaster = image === '/og.png';
  const imageWidth = options.imageWidth ?? (bundledRaster ? 1200 : undefined);
  const imageHeight = options.imageHeight ?? (bundledRaster ? 630 : undefined);
	const twitterSite = twitterSiteFromUrl(websiteConfig.social.x);
	return {
		scripts: noIndex ? [] : [jsonLdScript(publicPageGraph({
      path: routePath,
      siteUrl: websiteConfig.url,
      siteName: metadata.name,
      title,
      description,
      canonicalUrl: url,
      locale,
      logo: websiteConfig.metadata.images.logoLight,
      socialLinks: Object.entries(websiteConfig.social).filter(([key]) => key !== 'supportEmail').map(([, value]) => value),
    }))],
		meta: [
			{ title },
			{ name: "description", content: description },
			...(options.keywords ? [{ name: "keywords", content: options.keywords }] : []),
			{ property: "og:title", content: title },
			{ property: "og:site_name", content: metadata.name },
			{ property: "og:description", content: description },
			{ property: "og:url", content: url },
			{ property: "og:type", content: options.type ?? "website" },
			{
				property: "og:locale",
				content: (localeConfig[locale]?.hreflang || locale).replaceAll(
					"-",
					"_",
				),
			},
			{
				name: "twitter:card",
				content: image ? "summary_large_image" : "summary",
			},
			...(twitterSite ? [{ name: "twitter:site", content: twitterSite }] : []),
			...(image
				? [
						{
							property: "og:image",
							content: new URL(image, websiteConfig.url).href,
						},
            ...(imageWidth ? [{ property: 'og:image:width', content: String(imageWidth) }] : []),
            ...(imageHeight ? [{ property: 'og:image:height', content: String(imageHeight) }] : []),
            ...(bundledRaster ? [{ property: 'og:image:type', content: 'image/png' }] : []),
						{
							name: "twitter:image",
							content: new URL(image, websiteConfig.url).href,
						},
					]
				: []),
			...(noIndex
				? [{ name: "robots", content: "noindex, nofollow" }]
				: []),
		],
		links: [
			{ rel: "canonical", href: url },
			...alternateLocales.map((l) => ({
						rel: "alternate",
						hrefLang: localeConfig[l]?.hreflang || l,
						href: new URL(localePath(path, l), websiteConfig.url).href,
					})),
			...(defaultLocale
				? [
						{
							rel: "alternate",
							hrefLang: "x-default",
							href: new URL(localePath(path, defaultLocale), websiteConfig.url)
								.href,
						},
					]
				: []),
		],
	};
}
/** Public profile URLs only; never guess a handle from an arbitrary URL. */
export function twitterSiteFromUrl(value: string): string | undefined {
	try {
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.port ||
			!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(
				url.hostname,
			)
		)
			return undefined;
		const match = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(url.pathname);
		if (
			!match ||
			[
				"home",
				"explore",
				"i",
				"intent",
				"search",
				"share",
				"settings",
				"compose",
			].includes(match[1].toLowerCase())
		)
			return undefined;
		return `@${match[1]}`;
	} catch {
		return undefined;
	}
}
