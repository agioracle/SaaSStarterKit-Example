// Optional access also supports standalone React Email previews outside Vite.
import { m } from "../locale/paraglide/messages.js";
import { baseLocale, getLocale, type Locale } from "../locale";
import { groupedPlans } from "./plans";
import { DEFAULT_AI_POLICY } from "../ai/policy";
import { withAliases } from "./compatibility";
import type { MailProviderName } from "../mail/types";
import type { NewsletterProviderName } from "../newsletter/types";
import type { NotificationProviderName } from "../notification/types";

/** Explicit locale functions are an independent extension to string/getter configuration. */
export type MetadataText = string | ((locale: Locale) => string);
/** A per-resolution receiver carries locale without mutating shared configuration. */
export const metadataLocale = Symbol("metadataLocale");
export interface WebsiteMetadataConfig {
	name: MetadataText;
	title: MetadataText;
	description: MetadataText;
	images: { logoLight: string; logoDark: string; ogImage: string };
	[metadataLocale]?: Locale;
}
function currentMetadataLocale(): Locale {
	try {
		return getLocale();
	} catch {
		// Non-request consumers, such as auth setup and email previews, use the base locale.
		return baseLocale;
	}
}

/** Public feature controls. Provider credentials belong only in Worker bindings. */
export interface WebsiteServiceConfig {
	mail: {
		enable: boolean;
		provider: MailProviderName;
		fromEmail: string;
		supportEmail: string;
	};
	newsletter: {
		enabled: boolean;
		enable?: boolean;
		provider: NewsletterProviderName;
		autoSubscribe: boolean;
		autoSubscribeAfterSignUp?: boolean;
	};
	cache: { enabled: boolean; enable?: boolean; provider?: "kv"; ttl: number };
	notification: {
		enabled: boolean;
		enable?: boolean;
		provider: NotificationProviderName;
	};
}

const mode = withAliases(
	{ defaultMode: "system" as "light" | "dark" | "system", enableSwitch: true },
	{ default: "defaultMode", allowSwitch: "enableSwitch" },
);

// CLI uses "none" as an explicit disabled-payment marker, never a provider name.
const paymentProvider =
	import.meta.env?.VITE_PAYMENT_PROVIDER === "none"
		? ""
		: import.meta.env?.VITE_PAYMENT_PROVIDER || "";

export const websiteConfig = {
	/** Legacy read alias. Customize metadata.name to change branding everywhere. */
	get name(): string {
		const value = this.metadata.name;
		return typeof value === "function" ? value(currentMetadataLocale()) : value;
	},
	ai: { ...DEFAULT_AI_POLICY, userConcurrent: 2 },
	// VITE_BASE_URL is canonical; VITE_APP_URL remains a compatibility alias.
	url:
		import.meta.env?.VITE_BASE_URL ||
		import.meta.env?.VITE_APP_URL ||
		"http://localhost:3000",
	metadata: {
		// Strings and getters are supported. Use (locale) => ... for explicit locale functions.
		// This private receiver hint also keeps defaults request-safe outside SSR middleware.
		[metadataLocale]: undefined as Locale | undefined,
		get name() {
			return m.site_name({}, { locale: this[metadataLocale] ?? currentMetadataLocale() });
		},
		get title() {
			return m.site_title({}, { locale: this[metadataLocale] ?? currentMetadataLocale() });
		},
		get description() {
			return m.site_description({}, { locale: this[metadataLocale] ?? currentMetadataLocale() });
		},
		images: {
			logoLight: "/logo.svg",
			logoDark: "/logo-dark.svg",
			ogImage: "/og.png",
		},
	} as WebsiteMetadataConfig,
	ui: { mode },
	theme: mode,
	social: withAliases(
		{
			github: import.meta.env?.VITE_GITHUB_URL || "",
			twitter: import.meta.env?.VITE_X_URL || "",
			blueSky: "",
			discord: "",
			mastodon: "",
			linkedin: "",
			youtube: "",
			facebook: "",
			instagram: "",
			tiktok: "",
			telegram: "",
			supportEmail: import.meta.env?.VITE_SUPPORT_EMAIL || "",
		},
		{ x: "twitter" },
	),
	auth: withAliases(
		{
			enable: true,
			enableGoogleLogin: true,
			enableCredentialLogin: true,
			enableDeleteAccount: true,
		},
		{
			enabled: "enable",
			google: "enableGoogleLogin",
			credentials: "enableCredentialLogin",
			deleteUser: "enableDeleteAccount",
		},
	),
	blog: withAliases(
		{ enable: true, paginationSize: 6 },
		{ enabled: "enable", pageSize: "paginationSize" },
	),
	mail: {
		enable: true,
		provider: "cloudflare" as MailProviderName,
		// Configured addresses win; empty values use server-only MAIL_* aliases.
		fromEmail: "",
		supportEmail: import.meta.env?.VITE_SUPPORT_EMAIL || "",
	},
	newsletter: withAliases(
		{
			enable: false,
			provider: "resend" as NewsletterProviderName,
			autoSubscribeAfterSignUp: false,
		},
		{ enabled: "enable", autoSubscribe: "autoSubscribeAfterSignUp" },
	),
	cache: withAliases(
		{ enable: true, provider: "kv" as const, ttl: 300 },
		{ enabled: "enable" },
	),
	storage: withAliases(
		{
			enable: true,
			provider: "r2" as const,
			userFilesFolder: "userfiles",
			maxFileSize: 10 * 1024 * 1024,
			allowedTypes: [] as string[],
		},
		{ enabled: "enable", maxSize: "maxFileSize" },
	),
	notification: withAliases(
		{ enable: false, provider: "discord" as NotificationProviderName },
		{ enabled: "enable" },
	),
	payment: withAliases(
		{
			enable: /^[a-z][a-z0-9-]{0,63}$/.test(paymentProvider),
			price: { plans: groupedPlans },
			provider: paymentProvider,
		},
		{ enabled: "enable" },
	),
	analytics: {
		enabled: Boolean(
			import.meta.env?.VITE_GOOGLE_ANALYTICS_ID ||
				import.meta.env?.VITE_UMAMI_WEBSITE_ID ||
				import.meta.env?.VITE_PLAUSIBLE_SCRIPT ||
				import.meta.env?.VITE_PLAUSIBLE_DOMAIN ||
				import.meta.env?.VITE_CLARITY_PROJECT_ID,
		),
	},
	chatbox: { enabled: Boolean(import.meta.env?.VITE_CRISP_WEBSITE_ID) },
};

export type WebsiteConfig = typeof websiteConfig;
