import {
	defaultTransport,
	emailInput,
	ServiceError,
	type FetchTransport,
} from "../ai/http.server";
import { beehiivNewsletter } from "./provider/beehiiv.server";
import { mailcheapNewsletter } from "./provider/mailcheap.server";
import { resendNewsletter } from "./provider/resend.server";
import type {
	NewsletterConfig,
	NewsletterProvider,
	NewsletterStatusCache,
} from "./types";
import { featureEnabled } from "../config/compatibility";
import { websiteConfig, type WebsiteServiceConfig } from "../config/website";
export type * from "./types";
export function createNewsletterProvider(
	config: NewsletterConfig,
	transport: FetchTransport = defaultTransport,
): NewsletterProvider {
	switch (config.provider) {
		case "resend":
			return resendNewsletter(config.apiKey, transport);
		case "beehiiv":
			return beehiivNewsletter(config, transport);
		case "mailcheap":
			return mailcheapNewsletter(config, transport);
		default:
			throw new ServiceError("CONFIGURATION", "Unknown newsletter provider");
	}
}
export function newsletterConfigFromEnv(
	env: Record<string, unknown>,
	settings: WebsiteServiceConfig["newsletter"] = websiteConfig.newsletter,
): NewsletterConfig {
	if (!featureEnabled(settings))
		throw new ServiceError(
			"CONFIGURATION",
			"Newsletter is disabled in websiteConfig.",
		);
	const value = (name: string) =>
		typeof env[name] === "string" ? (env[name] as string) : "";
	const provider = settings.provider;
	if (provider === "resend")
		return { provider, apiKey: value("RESEND_API_KEY") };
	if (provider === "beehiiv")
		return {
			provider,
			apiKey: value("BEEHIIV_API_KEY"),
			publicationId: value("BEEHIIV_PUBLICATION_ID"),
		};
	if (provider === "mailcheap")
		return {
			provider,
			apiKey: value("MAILCHEAP_API_KEY"),
			newsletterId: value("MAILCHEAP_NEWSLETTER_ID"),
		};
	throw new ServiceError(
		"CONFIGURATION",
		"websiteConfig.newsletter.provider must be resend, beehiiv, or mailcheap",
	);
}

/** Application entry point shared by signup and self-service newsletter routes. */
export function createConfiguredNewsletterProvider(
	env: Record<string, unknown> & { CACHE?: NewsletterStatusCache },
	transport: FetchTransport = defaultTransport,
	settings: Pick<WebsiteServiceConfig, "newsletter" | "cache"> = websiteConfig,
): NewsletterProvider {
	if (!featureEnabled(settings.newsletter))
		throw new ServiceError(
			"CONFIGURATION",
			"Newsletter is disabled in websiteConfig.",
		);
	const factory = Object.hasOwn(providerRegistry, settings.newsletter.provider)
		? providerRegistry[settings.newsletter.provider]
		: undefined;
	if (!factory)
		throw new ServiceError("CONFIGURATION", "Unknown newsletter provider");
	const implementation = factory({
		env,
		transport,
		settings: settings.newsletter,
	});
	const provider: NewsletterProvider = {
		getProviderName: () => implementation.getProviderName(),
		subscribe(input) {
			if (input.consent !== true)
				throw new ServiceError(
					"VALIDATION",
					"Explicit newsletter consent is required",
				);
			return implementation.subscribe(input);
		},
		unsubscribe: (input) => implementation.unsubscribe(input),
		checkSubscribeStatus: (input) => implementation.checkSubscribeStatus(input),
	};
	const namespace = [
		settings.newsletter.provider,
		String(
			settings.newsletter.provider === "beehiiv"
				? (env.BEEHIIV_PUBLICATION_ID ?? "default")
				: settings.newsletter.provider === "mailcheap"
					? (env.MAILCHEAP_NEWSLETTER_ID ?? "default")
					: "default",
		),
	].join(":");
	return featureEnabled(settings.cache) && env.CACHE
		? withNewsletterStatusCache(
				provider,
				env.CACHE,
				namespace,
				settings.cache.ttl,
			)
		: provider;
}
/** Cache is optional and advisory. Namespace must uniquely identify provider/account/list. KV is eventually consistent. */
export function withNewsletterStatusCache(
	provider: NewsletterProvider,
	cache: NewsletterStatusCache,
	namespace: string,
	ttlSeconds = 300,
): NewsletterProvider {
	if (
		!namespace ||
		!Number.isInteger(ttlSeconds) ||
		ttlSeconds < 60 ||
		ttlSeconds > 3600
	)
		throw new ServiceError(
			"CONFIGURATION",
			"Invalid newsletter cache configuration",
		);
	async function key(email: string) {
		const hash = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(`${namespace}:${emailInput(email)}`),
		);
		return `newsletter:status:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
	}
	return {
		getProviderName: () => provider.getProviderName(),
		async subscribe(input) {
			try {
				return await provider.subscribe(input);
			} finally {
				await cache.delete(await key(input.email)).catch(() => undefined);
			}
		},
		async unsubscribe(input) {
			try {
				return await provider.unsubscribe(input);
			} finally {
				await cache.delete(await key(input.email)).catch(() => undefined);
			}
		},
		async checkSubscribeStatus(input) {
			const cacheKey = await key(input.email);
			const value = await cache.get(cacheKey).catch(() => null);
			if (value === "true" || value === "false") return value === "true";
			const result = await provider.checkSubscribeStatus(input);
			await cache
				.put(cacheKey, String(result), { expirationTtl: ttlSeconds })
				.catch(() => undefined);
			return result;
		},
	};
}

/** Stable, non-secret list namespace shared by signup and settings mutations. */
export function newsletterCacheNamespace(config: NewsletterConfig) {
	return `${config.provider}:${config.provider === "beehiiv" ? config.publicationId : config.provider === "mailcheap" ? config.newsletterId : "default"}`;
}

export interface NewsletterProviderContext {
	env: Record<string, unknown>;
	transport?: FetchTransport;
	settings?: WebsiteServiceConfig["newsletter"];
}
export type ProviderFactory = (
	context: NewsletterProviderContext,
) => NewsletterProvider;
/** Register custom providers here; every application subscription still requires explicit consent. */
export const providerRegistry: Record<string, ProviderFactory> = {
	resend: ({
		env,
		transport = defaultTransport,
		settings = websiteConfig.newsletter,
	}) =>
		createNewsletterProvider(
			newsletterConfigFromEnv(env, { ...settings, provider: "resend" }),
			transport,
		),
	beehiiv: ({
		env,
		transport = defaultTransport,
		settings = websiteConfig.newsletter,
	}) =>
		createNewsletterProvider(
			newsletterConfigFromEnv(env, { ...settings, provider: "beehiiv" }),
			transport,
		),
	mailcheap: ({
		env,
		transport = defaultTransport,
		settings = websiteConfig.newsletter,
	}) =>
		createNewsletterProvider(
			newsletterConfigFromEnv(env, { ...settings, provider: "mailcheap" }),
			transport,
		),
};
