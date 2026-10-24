import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { websiteConfig } from "../src/config/website";
import { withAliases, featureEnabled } from "../src/config/compatibility";
import {
	groupedPlans,
	publicPlans,
	flattenPricePlans,
} from "../src/config/plans";
import {
	getOrSetCache,
	deleteCache,
	deleteCacheByPrefix,
	invalidateCachePrefix,
	createCacheKey,
	CACHE_TTL,
} from "../src/cache";
import { sendEmail, providerRegistry as mailRegistry } from "../src/mail";
import { mailSupportAddressFromEnv } from "../src/mail/index.server";
import { EmailTemplates, EmailSubjects, renderEmail } from "../src/mail/render";
import { getMailtoUrl, parseMailbox } from "../src/mail/mailbox";
import {
	createConfiguredNewsletterProvider,
	providerRegistry as newsletterRegistry,
} from "../src/newsletter";
import {
	sendPaymentNotification,
	providerRegistry as notificationRegistry,
} from "../src/notification";
import {
	notificationToMinorUnits,
	sendPaymentNotification as sendInternalPaymentNotification,
} from "../src/notification/index.server";
import { getNavbarLinks } from "../src/config/navbar-config";
import { getFooterLinks } from "../src/config/footer-config";
import { getSidebarLinks } from "../src/config/sidebar-config";
import { getAvatarLinks } from "../src/config/avatar-config";
import { getSocialLinks } from "../src/config/social-config";
import { isMenuItemVisible } from "../src/config/menu";
import { Routes, routes } from "../src/lib/routes";
import type { FetchTransport } from "../src/ai/http.server";
import type { SendTemplateParams } from "../src/mail/types";
import { createElement } from "react";
import { handleContact } from "../src/api/contact.server";
import type { Bindings } from "../src/env";

declare module "../src/mail/types" {
	interface MailProviderNames {
		fixture: true;
	}
	interface EmailTemplateContexts {
		fixture: { username: string; actionUrl: string };
	}
}
declare module "../src/newsletter/types" {
	interface NewsletterProviderNames {
		fixture: true;
	}
}
declare module "../src/notification/types" {
	interface NotificationProviderNames {
		fixture: true;
	}
}

const runtime = vi.hoisted(() => ({
	cache: undefined as unknown,
	env: {} as Record<string, unknown>,
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("../src/api/rate-limit.server", () => ({
	rateLimit: vi.fn(async () => undefined),
}));
vi.mock("../src/cache/runtime.server", () => ({
	cacheBinding: () => runtime.cache,
}));
vi.mock("../src/api/runtime.server", () => ({ bindings: () => runtime.env }));
const defaults = Object.fromEntries(
	[
		"auth",
		"blog",
		"mail",
		"newsletter",
		"cache",
		"storage",
		"notification",
		"social",
		"payment",
	].map((key) => [
		key,
		{ ...(websiteConfig[key as keyof typeof websiteConfig] as object) },
	]),
);
const payment = {
	sessionId: "cs_fixture",
	customerId: "cus_fixture",
	userName: "Ada",
	amount: 19.99,
};
function cache() {
	return {
		get: vi.fn(async () => null as unknown),
		put: vi.fn(async () => undefined),
		delete: vi.fn(async () => undefined),
		list: vi.fn(async (_options: { prefix: string; cursor?: string }) => ({
			keys: [{ name: "product:a" }],
			list_complete: true,
			cursor: undefined as string | undefined,
		})),
	};
}
function transport(...responses: unknown[]) {
	return vi.fn<FetchTransport>(async () => {
		if (!responses.length) throw new Error("Unexpected provider request");
		return Response.json(responses.shift());
	});
}
beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Live service calls are forbidden");
		}),
	);
});
afterEach(() => {
	for (const [key, value] of Object.entries(defaults))
		Object.assign(websiteConfig[key as keyof typeof websiteConfig], value);
	runtime.cache = undefined;
	runtime.env = {};
	delete mailRegistry.fixture;
	delete newsletterRegistry.fixture;
	delete notificationRegistry.fixture;
	delete (EmailTemplates as Partial<typeof EmailTemplates>).fixture;
	delete (EmailSubjects as Partial<typeof EmailSubjects>).fixture;
	vi.unstubAllGlobals();
});

describe("documented cache entry points", () => {
	it("uses object options, configured Worker KV and documented TTL constants", async () => {
		const kv = cache();
		runtime.cache = kv;
		const key = createCacheKey("newsletter:status", "member");
		const source = vi.fn(async () => false);
		expect(
			await getOrSetCache({
				key,
				ttlSeconds: CACHE_TTL.newsletterStatus,
				fetcher: source,
			}),
		).toBe(false);
		expect(kv.put).toHaveBeenCalledWith(key, "false", { expirationTtl: 300 });
		kv.get.mockResolvedValue(false);
		expect(await getOrSetCache({ key, fetcher: source })).toBe(false);
		expect(source).toHaveBeenCalledTimes(1);
		await deleteCache(key);
		expect(kv.delete).toHaveBeenCalledWith(key);
		await deleteCacheByPrefix("product:");
		expect(kv.list).toHaveBeenCalledWith({
			prefix: "product:",
			cursor: undefined,
		});
	});
	it.each(["enable", "enabled"] as const)(
		"%s=false bypasses every KV entry point, even an explicit binding",
		async (flag) => {
			const kv = cache();
			kv.get.mockResolvedValue("stale");
			runtime.cache = kv;
			websiteConfig.cache[flag] = false;
			expect(await getOrSetCache(kv, "key", async () => "fresh")).toBe("fresh");
			expect(
				await getOrSetCache({
					key: "key",
					cache: kv,
					fetcher: async () => "fresh",
				}),
			).toBe("fresh");
			expect(
				await getOrSetCache({ key: "key", fetcher: async () => "fresh" }),
			).toBe("fresh");
			await deleteCache("key");
			await deleteCache(kv, "key");
			await deleteCacheByPrefix("prefix");
			await invalidateCachePrefix(kv, "prefix");
			expect(kv.get).not.toHaveBeenCalled();
			expect(kv.put).not.toHaveBeenCalled();
			expect(kv.delete).not.toHaveBeenCalled();
			expect(kv.list).not.toHaveBeenCalled();
		},
	);
	it("falls through absent/failed KV and propagates only the underlying fetcher error", async () => {
		expect(await getOrSetCache({ key: "key", fetcher: async () => 7 })).toBe(7);
		const kv = cache();
		kv.get.mockRejectedValue(new Error("offline"));
		kv.put.mockRejectedValue(new Error("offline"));
		expect(
			await getOrSetCache({
				key: "key",
				cache: kv,
				ttlSeconds: 1,
				fetcher: async () => 8,
			}),
		).toBe(8);
		expect(kv.put).toHaveBeenCalledWith("key", "8", { expirationTtl: 60 });
		await expect(
			getOrSetCache({
				key: "key",
				cache: kv,
				fetcher: async () => {
					throw new Error("source failed");
				},
			}),
		).rejects.toThrow("source failed");
		await expect(
			invalidateCachePrefix(undefined, "x"),
		).resolves.toBeUndefined();
	});
	it("bounds malformed repeated prefix cursors and swallows advisory failures", async () => {
		const kv = cache();
		kv.list.mockResolvedValue({
			keys: [],
			list_complete: false,
			cursor: "same",
		});
		await deleteCacheByPrefix(kv, "prefix");
		expect(kv.list).toHaveBeenCalledTimes(2);
		kv.list.mockRejectedValue(new Error("offline"));
		await expect(deleteCacheByPrefix(kv, "prefix")).resolves.toBeUndefined();
	});
});

describe("mail public facade and single mailbox validation", () => {
	it("routes contact form through the shared registered React template without weakening validation", async () => {
		websiteConfig.mail.provider = "resend";
		websiteConfig.mail.fromEmail = "hello@example.test";
		websiteConfig.mail.supportEmail = "Support <support@example.test>";
		const fetcher = transport({ id: "contact" });
		vi.stubGlobal("fetch", fetcher);
		const previous = EmailSubjects.contactMessage;
		EmailSubjects.contactMessage = "Shared contact subject";
		try {
			const response = await handleContact(
				new Request("https://app.example.test/api/contact", {
					method: "POST",
					headers: {
						origin: "https://app.example.test",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						name: "<b>Ada</b>",
						email: "ada@example.test",
						message: "A sufficiently long <script>contact</script> message.",
					}),
				}),
				{
					APP_URL: "https://app.example.test",
					RESEND_API_KEY: "fixture",
				} as unknown as Bindings,
			);
			expect(await response.json()).toEqual({ accepted: true });
			const payload = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
			expect(payload.subject).toBe("Shared contact subject");
			expect(payload.to).toEqual(["support@example.test"]);
			expect(payload.html).toContain("&lt;script&gt;");
			expect(payload.html).not.toContain("<script>");
		} finally {
			EmailSubjects.contactMessage = previous;
		}
	});

	it.each([
		"Support <support@example.test>",
		'"Support Team" <SUPPORT@example.test>',
		"support@example.test",
	])("supports configured mailbox %s", async (address) => {
		websiteConfig.mail.provider = "resend";
		websiteConfig.mail.fromEmail = "EdgeKit <hello@example.test>";
		websiteConfig.mail.supportEmail = address;
		const recipient = mailSupportAddressFromEnv({});
		expect(recipient).toBe("support@example.test");
		const fetcher = transport({ id: "sent-fixture" });
		await sendEmail(
			{
				to: address,
				subject: "Fixture",
				text: "Hello",
				replyTo: "Support <support@example.test>",
			},
			{ env: { RESEND_API_KEY: "fixture" }, transport: fetcher },
		);
		expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
			to: ["support@example.test"],
			reply_to: "support@example.test",
		});
		expect(getMailtoUrl(address)).toBe("mailto:support@example.test");
	});
	it.each([
		"Support <a@example.test>\r\nBcc: bad@example.test",
		"a@example.test,b@example.test",
		"Name <a@example.test> extra",
		"Bad\u0000 <a@example.test>",
		"<a@example.test>",
	])("rejects invalid mailbox %s", (value) => {
		expect(() => parseMailbox(value)).toThrow();
		expect(getMailtoUrl(value)).toBeUndefined();
	});
	it("uses template/context API and runtime credentials without a global provider singleton", async () => {
		websiteConfig.mail.provider = "resend";
		websiteConfig.mail.fromEmail = "hello@example.test";
		const fetcher = transport({ id: "a" }, { id: "b" });
		vi.stubGlobal("fetch", fetcher);
		const message: SendTemplateParams = {
			to: "a@example.test",
			template: "verifyEmail",
			context: { name: "Ada", url: "https://example.test/verify" },
		};
		runtime.env = { RESEND_API_KEY: "first" };
		await sendEmail(message);
		runtime.env = { RESEND_API_KEY: "second" };
		await sendEmail(message);
		expect(
			fetcher.mock.calls.map(
				([, init]) =>
					((init?.headers ?? {}) as Record<string, string>).Authorization,
			),
		).toEqual(["Bearer first", "Bearer second"]);
		await expect(
			renderEmail({
				template: "verifyEmail",
				context: { name: "Ada", url: "javascript:alert(1)" },
			}),
		).rejects.toThrow("HTTPS");
	});
	it("registers an independent provider and template without modifying dispatcher code", async () => {
		EmailTemplates.fixture = ({ username, actionUrl }) =>
			createElement("a", { href: actionUrl }, username);
		EmailSubjects.fixture = "Custom greeting";
		const rendered = await renderEmail({
			template: "fixture",
			context: { username: "Ada", actionUrl: "https://example.test/start" },
		});
		expect(rendered.subject).toBe("Custom greeting");
		expect(rendered.html).toContain("Ada");
		const send = vi.fn(async () => ({
			id: "fixture",
			provider: "fixture" as const,
			accepted: true as const,
		}));
		mailRegistry.fixture = () => ({
			getProviderName: () => "fixture",
			sendRawEmail: send,
			sendTemplate: send,
		});
		websiteConfig.mail.provider = "fixture";
		expect(
			await sendEmail(
				{
					to: "a@example.test",
					template: "fixture",
					context: { username: "Ada", actionUrl: "https://example.test/start" },
				},
				{ env: {} },
			),
		).toMatchObject({ provider: "fixture" });
		websiteConfig.mail.enable = false;
		await expect(
			sendEmail(
				{ to: "a@example.test", subject: "Fixture", text: "Hello" },
				{ env: {} },
			),
		).rejects.toThrow("disabled");
		expect(send).toHaveBeenCalledTimes(1);
	});
});

describe("newsletter and notification extension contracts", () => {
	it("registers newsletters while enforcing consent and public enable on the actual application entry point", async () => {
		websiteConfig.newsletter.enable = true;
		const subscribe = vi.fn(async () => true);
		newsletterRegistry.fixture = () => ({
			getProviderName: () => "fixture",
			subscribe,
			unsubscribe: async () => true,
			checkSubscribeStatus: async () => false,
		});
		websiteConfig.newsletter.provider = "fixture";
		const service = createConfiguredNewsletterProvider({});
		expect(() =>
			service.subscribe({ email: "a@example.test" } as never),
		).toThrow("consent");
		expect(subscribe).not.toHaveBeenCalled();
		expect(
			await service.subscribe({ email: "a@example.test", consent: true }),
		).toBe(true);
		websiteConfig.newsletter.enable = false;
		expect(() => createConfiguredNewsletterProvider({})).toThrow("disabled");
	});
	it("maps public major currency amounts exactly, without changing internal minor-unit notifications", async () => {
		websiteConfig.notification.enable = true;
		const fetcher = transport({ id: "public" }, { id: "internal" });
		const env = {
			DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/fixture",
		};
		expect(
			await sendPaymentNotification(payment, { env, transport: fetcher }),
		).toBeUndefined();
		await sendInternalPaymentNotification(
			env,
			{ ...payment, amount: 1999, currency: "USD" },
			fetcher,
		);
		const amounts = fetcher.mock.calls.map(
			([, init]) => JSON.parse(String(init?.body)).embeds[0].fields[1].value,
		);
		expect(amounts).toEqual(["$19.99", "$19.99"]);
		expect(
			notificationToMinorUnits({ ...payment, amount: 1999, currency: "JPY" })
				.amount,
		).toBe(1999);
		expect(
			notificationToMinorUnits({ ...payment, amount: 1.234, currency: "KWD" })
				.amount,
		).toBe(1234);
		expect(() =>
			notificationToMinorUnits({ ...payment, amount: 1.001 }),
		).toThrow("amount");
	});
	it("uses custom notification registry and never sends while the canonical flag is off", async () => {
		const send = vi.fn(async () => undefined);
		notificationRegistry.fixture = () => ({
			getProviderName: () => "fixture",
			sendPaymentNotification: send,
		});
		websiteConfig.notification.provider = "fixture";
		await sendPaymentNotification(payment, { env: {} });
		expect(send).not.toHaveBeenCalled();
		websiteConfig.notification.enable = true;
		await sendPaymentNotification(payment, { env: {} });
		expect(send).toHaveBeenCalledWith(payment);
		await sendInternalPaymentNotification(
			{},
			{ ...payment, amount: 1999, currency: "USD" },
		);
		expect(send).toHaveBeenLastCalledWith({ ...payment, currency: "USD" });
	});
});

describe("public configuration and navigation mappings", () => {
	it("shares live aliases and keeps canonical keys authoritative in explicit override objects", () => {
		const config = withAliases(
			{ enable: true, maxFileSize: 10 },
			{ enabled: "enable", maxSize: "maxFileSize" },
		);
		config.enabled = false;
		expect(config.enable).toBe(false);
		config.maxFileSize = 20;
		expect(config.maxSize).toBe(20);
		expect(Object.keys(config)).toEqual(["enable", "maxFileSize"]);
		expect(featureEnabled({ enable: false, enabled: true })).toBe(false);
		websiteConfig.auth.enableCredentialLogin = false;
		expect(websiteConfig.auth.credentials).toBe(false);
		websiteConfig.storage.maxFileSize = 42;
		expect(websiteConfig.storage.maxSize).toBe(42);
		websiteConfig.newsletter.autoSubscribeAfterSignUp = true;
		expect(websiteConfig.newsletter.autoSubscribe).toBe(true);
		expect(websiteConfig.ui.mode).toBe(websiteConfig.theme);
		expect(websiteConfig.cache.provider).toBe("kv");
	});
	it("maps all documented menu paths and suppresses disabled features", () => {
		websiteConfig.payment.enable = true;
		expect(getNavbarLinks().some((item) => item.href === Routes.Pricing)).toBe(
			true,
		);
		websiteConfig.blog.enable = false;
		expect(getNavbarLinks().some((item) => item.href === Routes.Blog)).toBe(
			false,
		);
		for (const item of [
			...getNavbarLinks(),
			...getFooterLinks(),
			...getSidebarLinks(),
			...getAvatarLinks(),
		])
			expect(typeof item.title).toBe("string");
		const admin = getSidebarLinks().find((item) => item.href === routes.users);
		if (!admin) throw new Error("Missing administrator menu contract");
		expect(typeof admin.icon).not.toBe("string");
		expect(admin.authorizeOnly).toEqual(["admin"]);
		expect(isMenuItemVisible(admin, "user")).toBe(false);
		expect(isMenuItemVisible(admin, "admin")).toBe(true);
		expect(
			isMenuItemVisible({ title: "none", authorizeOnly: [] }, "admin"),
		).toBe(false);
		websiteConfig.mail.supportEmail = "Support <support@example.test>";
		expect(
			getSocialLinks().some(
				(item) => item.href === "mailto:support@example.test",
			),
		).toBe(true);
		expect(Routes.Root).toBe(routes.home);
		expect(Routes.SettingsApiKeys).toBe(routes.apiKeys);
	});
	it("exposes grouped plans and a field-mapped flat view without renaming historical checkout ids", () => {
		expect(websiteConfig.payment.price.plans).toBe(groupedPlans);
		expect(Object.keys(groupedPlans)).toEqual(["free", "pro", "lifetime"]);
		expect(publicPlans.map((plan) => plan.id)).toEqual([
			"free",
			"pro-monthly",
			"pro-yearly",
			"lifetime",
		]);
		const fixture = {
			pro: {
				id: "pro",
				name: "Team",
				isFree: false,
				isLifetime: false,
				popular: true,
				limits: ["One account"],
				prices: [
					{
						type: "subscription" as const,
						priceId: "price_fixture",
						amount: 1200,
						currency: "USD",
						interval: "month" as const,
						allowPromotionCode: true,
					},
				],
			},
		};
		const flat = flattenPricePlans(fixture)[0];
		expect(flat).toMatchObject({
			id: "pro-monthly",
			amount: 1200,
			allowPromotionCodes: true,
			popular: true,
			limits: ["One account"],
		});
		fixture.pro.prices[0].amount = 1300;
		expect(flat.amount).toBe(1300);
	});
});
