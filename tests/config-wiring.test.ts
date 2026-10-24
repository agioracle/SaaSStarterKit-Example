import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	websiteConfig,
	type WebsiteServiceConfig,
} from "../src/config/website";
import { getLocalizedMetadata } from "../src/config/metadata";
import { getLocale } from "../src/locale";
import { seo } from "../src/lib/seo";
import { sendMailFromEnv } from "../src/mail/index.server";
import { createConfiguredNewsletterProvider } from "../src/newsletter/index.server";
import { sendPaymentNotification } from "../src/notification/index.server";
import { handleNewsletter } from "../src/api/newsletter.server";
import { handleContact } from "../src/api/contact.server";
import type { Bindings } from "../src/env";
import type { FetchTransport } from "../src/ai/http.server";
import en from "../messages/en.json";
import zh from "../messages/zh.json";

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("../src/api/rate-limit.server", () => ({
	rateLimit: vi.fn(async () => undefined),
}));
vi.mock("../src/locale", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/locale")>()),
	getLocale: vi.fn(() => "en"),
}));

// Exercise the public application entry points with the actual shared config, not
// just string inspections or direct low-level provider factories.
const settings: WebsiteServiceConfig = websiteConfig;
const defaults = structuredClone({
	mail: settings.mail,
	newsletter: settings.newsletter,
	cache: settings.cache,
	notification: settings.notification,
});
const account = "a".repeat(32);
const credentials = {
	CLOUDFLARE_ACCOUNT_ID: account,
	CLOUDFLARE_EMAIL_API_TOKEN: "fixture-cloudflare-token",
	RESEND_API_KEY: "fixture-resend-key",
	BEEHIIV_API_KEY: "fixture-beehiiv-key",
	BEEHIIV_PUBLICATION_ID: "pub_abcd-1234",
	MAILCHEAP_API_KEY: "fixture-mailcheap-key",
	MAILCHEAP_NEWSLETTER_ID: "weekly",
	MAIL_FROM_EMAIL: "Runtime <runtime@example.test>",
	MAIL_FROM: "legacy@example.test",
};
const mail = { to: "user@example.test", subject: "Fixture", text: "Hello" };
const payment = {
	sessionId: "cs_fixture",
	customerId: "cus_fixture",
	userName: "Fixture",
	amount: 1999,
	currency: "usd",
};
const webhooks = {
	DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/fixture-token",
	FEISHU_WEBHOOK_URL:
		"https://open.feishu.cn/open-apis/bot/v2/hook/fixture-token",
};
function transport(...results: unknown[]) {
	return vi.fn<FetchTransport>(async () => {
		if (!results.length) throw new Error("Unexpected provider request");
		return Response.json(results.shift());
	});
}
function cache() {
	const values = new Map<string, string>();
	return {
		get: vi.fn(async (key: string) => values.get(key) ?? null),
		put: vi.fn(
			async (
				key: string,
				value: string,
				_options: { expirationTtl: number },
			) => {
				values.set(key, value);
			},
		),
		delete: vi.fn(async (key: string) => {
			values.delete(key);
		}),
	};
}
beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Live provider calls are forbidden");
		}),
	);
	vi.mocked(getLocale).mockReturnValue("en");
});
afterEach(() => {
	Object.assign(settings.mail, defaults.mail);
	Object.assign(settings.newsletter, defaults.newsletter);
	Object.assign(settings.cache, defaults.cache);
	Object.assign(settings.notification, defaults.notification);
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("configured mail", () => {
	it.each(["cloudflare", "resend"] as const)(
		"uses websiteConfig.mail.provider=%s instead of a stale runtime selector",
		async (provider) => {
			settings.mail.provider = provider;
			settings.mail.fromEmail = "Configured <configured@example.test>";
			const fetcher = transport(
				provider === "cloudflare"
					? { success: true, result: { message_id: "cf-fixture" } }
					: { id: "resend-fixture" },
			);
			const result = await sendMailFromEnv(
				{
					...credentials,
					MAIL_PROVIDER: provider === "resend" ? "cloudflare" : "resend",
				},
				mail,
				fetcher,
			);
			expect(result.provider).toBe(provider);
			expect(fetcher.mock.calls[0][0]).toBe(
				provider === "cloudflare"
					? `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`
					: "https://api.resend.com/emails",
			);
			expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).from).toBe(
				settings.mail.fromEmail,
			);
		},
	);
	it("uses MAIL_FROM_EMAIL before MAIL_FROM only when the configured sender is empty", async () => {
		settings.mail.provider = "resend";
		const fetcher = transport({ id: "mail-1" }, { id: "mail-2" });
		await sendMailFromEnv(credentials, mail, fetcher);
		await sendMailFromEnv(
			{ ...credentials, MAIL_FROM_EMAIL: "" },
			mail,
			fetcher,
		);
		expect(
			fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).from),
		).toEqual([credentials.MAIL_FROM_EMAIL, credentials.MAIL_FROM]);
	});
	it("rejects disabled mail and missing selected credentials without sending or falling back", async () => {
		const fetcher = transport();
		settings.mail.enable = false;
		expect(() => sendMailFromEnv(credentials, mail, fetcher)).toThrow(
			"Mail is disabled",
		);
		settings.mail.enable = true;
		settings.mail.provider = "resend";
		expect(() =>
			sendMailFromEnv({ ...credentials, RESEND_API_KEY: "" }, mail, fetcher),
		).toThrow("RESEND_API_KEY");
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("sends contact mail to the configured support recipient, not the sender or runtime alias", async () => {
		settings.mail.provider = "resend";
		settings.mail.fromEmail = "hello@example.test";
		settings.mail.supportEmail = "Support@Example.test";
		const fetcher = transport({ id: "contact-fixture" });
		vi.stubGlobal("fetch", fetcher);
		const response = await handleContact(
			new Request("https://app.example.test/api/contact", {
				method: "POST",
				headers: {
					origin: "https://app.example.test",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					name: "Ada",
					email: "ada@example.test",
					message: "A sufficiently long contact message.",
				}),
			}),
			{
				...credentials,
				APP_URL: "https://app.example.test",
				MAIL_SUPPORT_EMAIL: "alias@example.test",
			} as unknown as Bindings,
		);
		expect(await response.json()).toEqual({ accepted: true });
		expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
			from: "hello@example.test",
			to: ["support@example.test"],
			reply_to: "ada@example.test",
		});
	});
	it("rejects a disabled contact endpoint before rate limiting or sending", async () => {
		settings.mail.enable = false;
		await expect(
			handleContact(
				new Request("https://app.example.test/api/contact", { method: "POST" }),
				{} as Bindings,
			),
		).rejects.toMatchObject({ status: 503, message: "Mail is disabled." });
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe("configured newsletter and cache", () => {
	beforeEach(() => { settings.newsletter.enabled = true; });
	it.each([
		["resend", "api.resend.com", { unsubscribed: false }],
		[
			"beehiiv",
			"api.beehiiv.com",
			{ data: { id: "sub_fixture", status: "active" } },
		],
		["mailcheap", "mailcheap.ai", { id: "contact-fixture", status: "active" }],
	] as const)(
		"uses the configured %s adapter with credentials only from env",
		async (provider, host, response) => {
			settings.newsletter.provider = provider;
			const fetcher = transport(response);
			const service = createConfiguredNewsletterProvider(
				{ ...credentials, NEWSLETTER_PROVIDER: "ignored-legacy-selector" },
				fetcher,
			);
			expect(
				await service.checkSubscribeStatus({ email: "member@example.test" }),
			).toBe(true);
			expect(new URL(fetcher.mock.calls[0][0]).hostname).toBe(host);
			expect(service.getProviderName()).toBe(provider);
		},
	);
	it("applies the configured TTL in the real newsletter API and returns cached status", async () => {
		settings.cache.ttl = 127;
		const kv = cache();
		const fetcher = transport({ unsubscribed: false });
		vi.stubGlobal("fetch", fetcher);
		const env = { ...credentials, CACHE: kv } as unknown as Bindings;
		for (let i = 0; i < 2; i++) {
			const result = await handleNewsletter(
				new Request("https://app.example.test/api/newsletter"),
				env,
				"member@example.test",
			);
			expect(await result.json()).toEqual({ subscribed: true });
		}
		expect(kv.put).toHaveBeenCalledWith(
			expect.stringMatching(/^newsletter:status:/),
			"true",
			{ expirationTtl: 127 },
		);
		expect(kv.put.mock.calls[0][0]).not.toContain("member@example.test");
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
	it("bypasses disabled or unavailable caching and survives KV read/write errors", async () => {
		const kv = cache();
		const fetcher = transport(
			{ unsubscribed: false },
			{ unsubscribed: false },
			{ unsubscribed: false },
		);
		settings.cache.enabled = false;
		await createConfiguredNewsletterProvider(
			{ ...credentials, CACHE: kv },
			fetcher,
		).checkSubscribeStatus({ email: "a@example.test" });
		expect(kv.get).not.toHaveBeenCalled();
		settings.cache.enabled = true;
		await createConfiguredNewsletterProvider(
			credentials,
			fetcher,
		).checkSubscribeStatus({ email: "a@example.test" });
		kv.get.mockRejectedValue(new Error("KV unavailable"));
		kv.put.mockRejectedValue(new Error("KV unavailable"));
		await expect(
			createConfiguredNewsletterProvider(
				{ ...credentials, CACHE: kv },
				fetcher,
			).checkSubscribeStatus({ email: "a@example.test" }),
		).resolves.toBe(true);
		expect(fetcher).toHaveBeenCalledTimes(3);
	});
	it("rejects disabled newsletter operations and invalid active cache TTL before requests", async () => {
		const fetcher = transport();
		settings.newsletter.enabled = false;
		expect(() =>
			createConfiguredNewsletterProvider(credentials, fetcher),
		).toThrow("Newsletter is disabled");
		await expect(
			handleNewsletter(
				new Request("https://app.example.test/api/newsletter"),
				{} as Bindings,
				"a@example.test",
			),
		).rejects.toMatchObject({ status: 404 });
		settings.newsletter.enabled = true;
		settings.cache.ttl = 30;
		expect(() =>
			createConfiguredNewsletterProvider(
				{ ...credentials, CACHE: cache() },
				fetcher,
			),
		).toThrow("cache configuration");
		expect(fetcher).not.toHaveBeenCalled();
	});
});

describe("configured notifications", () => {
	it.each(["discord", "feishu"] as const)(
		"sends only to %s when both webhook credentials exist",
		async (provider) => {
			settings.notification.enabled = true;
			settings.notification.provider = provider;
			const fetcher = transport(
				provider === "discord" ? { id: "message-fixture" } : { code: 0 },
			);
			expect(await sendPaymentNotification(webhooks, payment, fetcher)).toEqual(
				[{ channel: provider, accepted: true }],
			);
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(new URL(fetcher.mock.calls[0][0]).hostname).toBe(
				provider === "discord" ? "discord.com" : "open.feishu.cn",
			);
		},
	);
	it("does not send or claim acceptance while disabled", async () => {
		const fetcher = transport();
		expect(await sendPaymentNotification(webhooks, payment, fetcher)).toEqual(
			[],
		);
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("does not fall back to the unselected destination when selected credentials are missing", async () => {
		settings.notification.enabled = true;
		settings.notification.provider = "feishu";
		const fetcher = transport();
		await expect(
			sendPaymentNotification(
				{ DISCORD_WEBHOOK_URL: webhooks.DISCORD_WEBHOOK_URL },
				payment,
				fetcher,
			),
		).rejects.toThrow("FEISHU_WEBHOOK_URL");
		expect(fetcher).not.toHaveBeenCalled();
	});
});

describe("localized metadata and canonical configuration", () => {
	it.each([
		["en", en],
		["zh", zh],
	] as const)(
		"feeds %s message metadata into SEO and structured data",
		(locale, messages) => {
			vi.mocked(getLocale).mockReturnValue(locale);
			const metadata = getLocalizedMetadata(locale);
			expect(metadata).toMatchObject({
				name: messages.site_name,
				title: messages.site_title,
				description: messages.site_description,
			});
			const head = seo("/", {});
			expect(head.meta).toContainEqual({ title: messages.site_title });
			expect(head.meta).toContainEqual({
				name: "description",
				content: messages.site_description,
			});
			expect(head.meta).toContainEqual({
				property: "og:site_name",
				content: messages.site_name,
			});
			const graph = JSON.parse(head.scripts[0].children)["@graph"];
			expect(graph[0].name).toBe(messages.site_name);
			expect(graph[2]).toMatchObject({
				name: messages.site_title,
				description: messages.site_description,
				inLanguage: locale,
			});
		},
	);
	it("keeps explicit request locales isolated", () => {
		vi.mocked(getLocale).mockReturnValue("zh");
		expect(getLocalizedMetadata("en").description).toBe(en.site_description);
		expect(getLocalizedMetadata("zh").description).toBe(zh.site_description);
		expect(getLocalizedMetadata("en").description).toBe(en.site_description);
	});
	it.each([
		["Sign in", "登录"],
		["Create account", "创建账户"],
		["Reset your password", "重置密码"],
		["Choose a new password", "设置新密码"],
		["Authentication error", "身份验证错误"],
	])(
		"localizes the private %s head without structured data",
		(title, translated) => {
			vi.mocked(getLocale).mockReturnValue("zh");
			const head = seo("/auth/login", { title, noIndex: true });
			expect(head.meta).toContainEqual({
				title: `${translated} · ${zh.site_name}`,
			});
			expect(head.scripts).toEqual([]);
			expect(head.links.filter((link) => link.rel === "alternate")).toEqual([]);
		},
	);
	it("uses VITE_BASE_URL for actual SEO links before the VITE_APP_URL compatibility alias", async () => {
		vi.stubEnv("VITE_BASE_URL", "https://canonical.example.test");
		vi.stubEnv("VITE_APP_URL", "https://legacy.example.test");
		vi.resetModules();
		const { seo: configuredSeo } = await import("../src/lib/seo");
		const head = configuredSeo("/about", {});
		expect(
			head.links.every(
				(link) =>
					new URL(link.href).origin === "https://canonical.example.test",
			),
		).toBe(true);
		expect(head.meta).toContainEqual({
			property: "og:image",
			content: "https://canonical.example.test/og.png",
		});
		vi.stubEnv("VITE_BASE_URL", "");
		vi.resetModules();
		const { websiteConfig: aliasConfig } = await import(
			"../src/config/website"
		);
		expect(aliasConfig.url).toBe("https://legacy.example.test");
	});
});
