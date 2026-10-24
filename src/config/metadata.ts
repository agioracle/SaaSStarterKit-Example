import { baseLocale, type Locale } from "../locale";
import { getServerAsyncLocalStorage } from "../locale/paraglide/runtime";
import { metadataLocale, websiteConfig, type WebsiteMetadataConfig } from "./website";

/** Resolve the public metadata configuration, not a parallel hard-coded message source.
 * SSR getters run inside the existing request-local store. Defaults and locale functions
 * also support explicit locale resolution outside middleware, without global overrides.
 * Custom getters using implicit m.*() should run in a request; for cross-locale client
 * previews, use a function receiving locale and pass it to m.*({}, { locale }).
 */
export function getLocalizedMetadata(locale: Locale = baseLocale) {
	const resolve = () => {
		const configured = Object.create(websiteConfig.metadata) as WebsiteMetadataConfig;
		Object.defineProperty(configured, metadataLocale, { value: locale });
		const text = (field: "name" | "title" | "description"): string => {
			const configuredValue = configured[field];
			const value = typeof configuredValue === "function" ? configuredValue(locale) : configuredValue;
			if (typeof value !== "string") throw new TypeError(`websiteConfig.metadata.${field} must resolve to a string`);
			return value;
		};
		return {
			name: text("name"),
			title: text("title"),
			description: text("description"),
			siteUrl: websiteConfig.url,
			image: websiteConfig.metadata.images.ogImage,
			locale,
		};
	};
	const storage = getServerAsyncLocalStorage();
	return storage ? storage.run({ ...storage.getStore(), locale }, resolve) as ReturnType<typeof resolve> : resolve();
}
