import {
	defaultTransport,
	record,
	requestJson,
	requiredConfig,
	ServiceError,
	textInput,
	type FetchTransport,
} from "../ai/http.server";
import type {
	NotificationConfig,
	NotificationDelivery,
	NotificationService,
	PaymentNotification,
	NotificationProvider,
	SendPaymentNotificationParams,
} from "./types";
import { featureEnabled } from "../config/compatibility";
import { websiteConfig, type WebsiteServiceConfig } from "../config/website";
export type * from "./types";
function webhook(value: string, channel: "discord" | "feishu"): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new ServiceError("CONFIGURATION", `Invalid ${channel} webhook`);
	}
	const validHost =
		channel === "discord"
			? ["discord.com", "discordapp.com"].includes(url.hostname)
			: ["open.feishu.cn", "open.larksuite.com"].includes(url.hostname);
	const validPath =
		channel === "discord"
			? /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z\d_.-]+$/.test(url.pathname)
			: /^\/open-apis\/bot\/v2\/hook\/[A-Za-z\d-]+$/.test(url.pathname);
	if (
		url.protocol !== "https:" ||
		!validHost ||
		!validPath ||
		url.username ||
		url.password ||
		url.port ||
		url.hash
	)
		throw new ServiceError("CONFIGURATION", `Invalid ${channel} webhook`);
	url.search = "";
	if (channel === "discord") url.searchParams.set("wait", "true");
	return url.toString();
}
export async function createFeishuSignature(
	secret: string,
	timestamp: number,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(`${timestamp}\n${secret}`),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const bytes = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, new Uint8Array()),
	);
	return btoa(String.fromCharCode(...bytes));
}
function paymentFields(input: PaymentNotification) {
	const sessionId = textInput(input.sessionId, "Session ID", 1, 200);
	const customerId = textInput(input.customerId, "Customer ID", 1, 200);
	if (![sessionId, customerId].every((value) => /^[A-Za-z0-9_-]+$/.test(value)))
		throw new ServiceError("VALIDATION", "Invalid payment identifier");
	// Prevent markup-based mentions in Feishu; Discord also disables allowed_mentions.
	const userName = textInput(input.userName, "User name", 1, 100).replace(
		/[<>]/g,
		"",
	);
	if (!Number.isSafeInteger(input.amount) || input.amount < 0)
		throw new ServiceError(
			"VALIDATION",
			"Payment amount must be non-negative integer minor units",
		);
	const amountLabel = input.amountLabel ?? "Configured plan price";
	if (!["Configured plan price", "Amount paid"].includes(amountLabel))
		throw new ServiceError("VALIDATION", "Invalid payment amount label");
	const currency = textInput(input.currency, "Currency", 3, 3).toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency))
		throw new ServiceError("VALIDATION", "Invalid currency");
	let format: Intl.NumberFormat;
	try {
		format = new Intl.NumberFormat("en-US", { style: "currency", currency });
	} catch {
		throw new ServiceError("VALIDATION", "Unsupported currency");
	}
	const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
	return {
		sessionId,
		customerId,
		userName,
		amountLabel,
		amount: format.format(input.amount / 10 ** digits),
	};
}
export function notificationConfigFromEnv(
	env: Record<string, unknown>,
	settings: WebsiteServiceConfig["notification"] = websiteConfig.notification,
): NotificationConfig {
	if (!featureEnabled(settings))
		throw new ServiceError(
			"CONFIGURATION",
			"Notifications are disabled in websiteConfig.",
		);
	const value = (name: string) =>
		typeof env[name] === "string" ? (env[name] as string) : undefined;
	// Select exactly one destination even when both webhook credentials are present.
	if (settings.provider === "discord")
		return {
			discordWebhookUrl: requiredConfig(
				value("DISCORD_WEBHOOK_URL"),
				"DISCORD_WEBHOOK_URL",
			),
		};
	if (settings.provider === "feishu")
		return {
			feishuWebhookUrl: requiredConfig(
				value("FEISHU_WEBHOOK_URL"),
				"FEISHU_WEBHOOK_URL",
			),
			feishuSecret: value("FEISHU_WEBHOOK_SECRET"),
		};
	throw new ServiceError(
		"CONFIGURATION",
		"websiteConfig.notification.provider must be discord or feishu",
	);
}
export function createNotificationService(
	config: NotificationConfig,
	transport: FetchTransport = defaultTransport,
	now: () => number = Date.now,
): NotificationService {
	if (!config.discordWebhookUrl && !config.feishuWebhookUrl)
		throw new ServiceError(
			"CONFIGURATION",
			"Configure DISCORD_WEBHOOK_URL or FEISHU_WEBHOOK_URL",
		);
	const discord = config.discordWebhookUrl
		? webhook(config.discordWebhookUrl, "discord")
		: undefined;
	const feishu = config.feishuWebhookUrl
		? webhook(config.feishuWebhookUrl, "feishu")
		: undefined;
	return {
		async sendPaymentNotification(input) {
			const fields = paymentFields(input);
			const deliveries: Array<Promise<NotificationDelivery>> = [];
			const send = async (
				channel: "discord" | "feishu",
				url: string,
				json: unknown,
			): Promise<NotificationDelivery> => {
				try {
					const result = await requestJson(transport, url, { json });
					if (channel === "feishu") {
						const data = record(result);
						if (data.code !== 0 && data.StatusCode !== 0)
							throw new ServiceError(
								"UPSTREAM",
								"Feishu rejected the notification",
							);
					} else {
						const data = record(result);
						if (typeof data.id !== "string")
							throw new ServiceError(
								"UPSTREAM",
								"Discord returned no message acknowledgement",
							);
					}
					return { channel, accepted: true };
				} catch (error) {
					// A failed optional notification must not cause a paid webhook to replay its financial side effects.
					return {
						channel,
						accepted: false,
						error:
							error instanceof ServiceError
								? error.message
								: "Notification failed",
					};
				}
			};
			if (discord)
				deliveries.push(
					send("discord", discord, {
						allowed_mentions: { parse: [] },
						embeds: [
							{
								title: "Payment access updated",
								color: 0x2ecc71,
								fields: [
									{ name: "Customer", value: fields.userName, inline: true },
									{
										name: fields.amountLabel,
										value: fields.amount,
										inline: true,
									},
									{ name: "Session", value: fields.sessionId },
									{ name: "Customer ID", value: fields.customerId },
								],
								timestamp: new Date(now()).toISOString(),
							},
						],
					}),
				);
			if (feishu) {
				const timestamp = Math.floor(now() / 1000);
				const signature = config.feishuSecret
					? {
							timestamp: String(timestamp),
							sign: await createFeishuSignature(config.feishuSecret, timestamp),
						}
					: {};
				deliveries.push(
					send("feishu", feishu, {
						...signature,
						msg_type: "text",
						content: {
							text: `Payment access updated\nCustomer: ${fields.userName}\n${fields.amountLabel}: ${fields.amount}\nSession: ${fields.sessionId}\nCustomer ID: ${fields.customerId}`,
						},
					}),
				);
			}
			return Promise.all(deliveries);
		},
	};
}
export async function sendPaymentNotification(
	env: Record<string, unknown>,
	input: PaymentNotification,
	transport: FetchTransport = defaultTransport,
	settings: WebsiteServiceConfig["notification"] = websiteConfig.notification,
) {
	// An optional disabled notification is an intentional no-op, never an accepted send.
	if (!featureEnabled(settings)) return [];
	const provider = getNotificationProvider({ env, transport, settings });
	if (provider.sendMinorUnitPaymentNotification) {
		// Built-in adapters retain exact ledger amounts through the same registry.
		return provider.sendMinorUnitPaymentNotification(input);
	}
	paymentFields(input);
	try {
		await provider.sendPaymentNotification({
			...input,
			amount: input.amount / currencyFactor(input.currency),
		});
		return [{ channel: settings.provider, accepted: true }];
	} catch {
		return [
			{
				channel: settings.provider,
				accepted: false,
				error: "Notification failed",
			},
		];
	}
}

function currencyFactor(currency: string) {
	if (!/^[a-z]{3}$/i.test(currency))
		throw new ServiceError("VALIDATION", "Invalid currency");
	return (
		10 **
		(new Intl.NumberFormat("en-US", {
			style: "currency",
			currency,
		}).resolvedOptions().maximumFractionDigits ?? 2)
	);
}
export function notificationToMinorUnits(
	input: SendPaymentNotificationParams,
): PaymentNotification {
	const currency = input.currency ?? "USD";
	const value = input.amount * currencyFactor(currency);
	const minor = Math.round(value);
	if (
		!Number.isFinite(value) ||
		!Number.isSafeInteger(minor) ||
		minor < 0 ||
		Math.abs(value - minor) > 1e-6
	)
		throw new ServiceError("VALIDATION", "Invalid major-unit payment amount");
	return { ...input, amount: minor, currency };
}
export interface NotificationProviderContext {
	env: Record<string, unknown>;
	transport?: FetchTransport;
	settings?: WebsiteServiceConfig["notification"];
}
export interface ConfiguredNotificationProvider extends NotificationProvider {
	/** Optional exact-integer bridge for internal verified ledger notifications. */
	sendMinorUnitPaymentNotification?(
		input: PaymentNotification,
	): Promise<NotificationDelivery[]>;
}
export type ProviderFactory = (
	context: NotificationProviderContext,
) => ConfiguredNotificationProvider;
function builtInProvider(
	channel: "discord" | "feishu",
	context: NotificationProviderContext,
): ConfiguredNotificationProvider {
	const settings = {
		...(context.settings ?? websiteConfig.notification),
		provider: channel,
	};
	const service = createNotificationService(
		notificationConfigFromEnv(context.env, settings),
		context.transport,
	);
	return {
		getProviderName: () => channel,
		sendMinorUnitPaymentNotification: (input) =>
			service.sendPaymentNotification(input),
		async sendPaymentNotification(input) {
			const result = await service.sendPaymentNotification(
				notificationToMinorUnits(input),
			);
			if (result.some((item) => !item.accepted))
				throw new ServiceError("UPSTREAM", "Notification failed");
		},
	};
}
export const providerRegistry: Record<string, ProviderFactory> = {
	discord: (context) => builtInProvider("discord", context),
	feishu: (context) => builtInProvider("feishu", context),
};
export function getNotificationProvider(
	context: NotificationProviderContext,
): ConfiguredNotificationProvider {
	const settings = context.settings ?? websiteConfig.notification;
	if (!featureEnabled(settings))
		throw new ServiceError(
			"CONFIGURATION",
			"Notifications are disabled in websiteConfig.",
		);
	const factory = Object.hasOwn(providerRegistry, settings.provider)
		? providerRegistry[settings.provider]
		: undefined;
	if (!factory)
		throw new ServiceError("CONFIGURATION", "Unknown notification provider");
	return factory({ ...context, settings });
}
export async function sendPublicPaymentNotification(
	input: SendPaymentNotificationParams,
	context?: NotificationProviderContext,
): Promise<void> {
	if (!featureEnabled(context?.settings ?? websiteConfig.notification)) return;
	const resolved = context ?? {
		env: (await import("../api/runtime.server")).bindings(),
	};
	await getNotificationProvider(resolved).sendPaymentNotification(input);
}
