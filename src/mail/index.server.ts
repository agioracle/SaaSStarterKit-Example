import {
	bearer,
	cfResult,
	defaultTransport,
	record,
	requestJson,
	requiredConfig,
	ServiceError,
	stringField,
	textInput,
	type FetchTransport,
} from "../ai/http.server";
import type {
	MailConfig,
	MailProvider,
	RawEmail,
	SendTemplateParams,
	SendEmailResult,
} from "./types";
import { websiteConfig, type WebsiteServiceConfig } from "../config/website";
import { renderMailTemplate, renderEmail } from "./templates.server";
import { parseMailbox } from "./mailbox";
export { renderAuthEmail, renderMailTemplate } from "./templates.server";
export type * from "./types";
function mailboxAddress(value: string, configuration = false): string {
	try {
		return parseMailbox(value).address;
	} catch {
		throw new ServiceError(
			configuration ? "CONFIGURATION" : "VALIDATION",
			"Invalid email mailbox",
		);
	}
}
function fromAddress(value: string): string {
	mailboxAddress(value, true);
	return value.trim();
}
export function createMailProvider(
	config: MailConfig,
	transport: FetchTransport = defaultTransport,
): MailProvider {
	const from = fromAddress(
		requiredConfig(
			config.from,
			"websiteConfig.mail.fromEmail or MAIL_FROM_EMAIL",
		),
	);
	const token =
		config.provider === "cloudflare"
			? requiredConfig(
					config.apiToken,
					"CLOUDFLARE_EMAIL_API_TOKEN or CLOUDFLARE_API_TOKEN",
				)
			: requiredConfig(config.apiKey, "RESEND_API_KEY");
	const account =
		config.provider === "cloudflare"
			? requiredConfig(config.accountId, "CLOUDFLARE_ACCOUNT_ID")
			: undefined;
	if (account && !/^[a-f\d]{32}$/i.test(account))
		throw new ServiceError(
			"CONFIGURATION",
			"Invalid Cloudflare account identifier",
		);
	if (!["cloudflare", "resend"].includes(config.provider))
		throw new ServiceError("CONFIGURATION", "Unknown mail provider");
	const provider: MailProvider = {
		getProviderName: () => config.provider,
		async sendRawEmail(message) {
			const to = mailboxAddress(message.to);
			const subject = textInput(message.subject, "Subject", 1, 200);
			if (/[\r\n]/.test(subject))
				throw new ServiceError("VALIDATION", "Subject must be a single line");
			if (!message.html?.trim() && !message.text?.trim())
				throw new ServiceError(
					"VALIDATION",
					"Email must contain HTML or plain text",
				);
			const payload = {
				from,
				to: [to],
				subject,
				...(message.html
					? { html: textInput(message.html, "HTML", 1, 250_000) }
					: {}),
				...(message.text
					? { text: textInput(message.text, "Text", 1, 250_000) }
					: {}),
				...(message.replyTo
					? { reply_to: mailboxAddress(message.replyTo) }
					: {}),
			};
			const idempotencyKey = message.idempotencyKey
				? textInput(message.idempotencyKey, "Idempotency key", 1, 256)
				: undefined;
			if (idempotencyKey && /[\r\n]/.test(idempotencyKey))
				throw new ServiceError("VALIDATION", "Invalid idempotency key");
			const result = await requestJson(
				transport,
				config.provider === "cloudflare"
					? `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`
					: "https://api.resend.com/emails",
				{
					headers: {
						...bearer(token),
						...(config.provider === "resend" && idempotencyKey
							? { "Idempotency-Key": idempotencyKey }
							: {}),
					},
					json: payload,
				},
			);
			const data =
				config.provider === "cloudflare" ? cfResult(result) : record(result);
			if (
				config.provider === "cloudflare" &&
				Array.isArray(data.permanent_bounces) &&
				data.permanent_bounces.includes(to)
			)
				throw new ServiceError("UPSTREAM", "Email permanently bounced");
			if (
				config.provider === "cloudflare" &&
				Array.isArray(data.suppressed_recipients) &&
				data.suppressed_recipients.includes(to)
			)
				throw new ServiceError("UPSTREAM", "Email recipient is suppressed");
			return {
				id: stringField(
					config.provider === "cloudflare" ? data.message_id : data.id,
				),
				provider: config.provider,
				accepted: true,
			};
		},
		async sendTemplate(input) {
			const rendered =
				typeof input.template === "string"
					? await renderEmail(input as SendTemplateParams)
					: await renderMailTemplate(input.template);
			return provider.sendRawEmail({
				to: input.to,
				replyTo: input.replyTo,
				...rendered,
			});
		},
	};
	return provider;
}
/** Select the provider in websiteConfig; runtime bindings supply credentials only. */
export function mailConfigFromEnv(
	env: Record<string, unknown>,
	settings: WebsiteServiceConfig["mail"] = websiteConfig.mail,
): MailConfig {
	if (!settings.enable)
		throw new ServiceError(
			"CONFIGURATION",
			"Mail is disabled in websiteConfig.",
		);
	const value = (name: string) =>
		typeof env[name] === "string" ? (env[name] as string) : "";
	const provider = settings.provider;
	const from =
		settings.fromEmail.trim() || value("MAIL_FROM_EMAIL") || value("MAIL_FROM");
	if (provider === "cloudflare")
		return {
			provider,
			from,
			accountId: value("CLOUDFLARE_ACCOUNT_ID"),
			apiToken:
				value("CLOUDFLARE_EMAIL_API_TOKEN") || value("CLOUDFLARE_API_TOKEN"),
		};
	if (provider === "resend")
		return { provider, from, apiKey: value("RESEND_API_KEY") };
	throw new ServiceError(
		"CONFIGURATION",
		"websiteConfig.mail.provider must be cloudflare or resend",
	);
}
/** Configured support recipient takes precedence over the runtime compatibility alias. */
export function mailSupportAddressFromEnv(
	env: Record<string, unknown>,
	settings: WebsiteServiceConfig["mail"] = websiteConfig.mail,
): string {
	const fallback =
		typeof env.MAIL_SUPPORT_EMAIL === "string" ? env.MAIL_SUPPORT_EMAIL : "";
	return mailboxAddress(
		requiredConfig(
			settings.supportEmail.trim() || fallback,
			"websiteConfig.mail.supportEmail or MAIL_SUPPORT_EMAIL",
		),
	);
}
export function sendMailFromEnv(
	env: Record<string, unknown>,
	message: RawEmail,
	transport: FetchTransport = defaultTransport,
	settings: WebsiteServiceConfig["mail"] = websiteConfig.mail,
) {
	return getMailProvider({ env, transport, settings }).sendRawEmail(message);
}

export interface MailProviderContext {
	env: Record<string, unknown>;
	transport?: FetchTransport;
	settings?: WebsiteServiceConfig["mail"];
}
export type ProviderFactory = (context: MailProviderContext) => MailProvider;
/** Add a factory here and a provider name in types.ts; no global credential-bearing instances. */
export const providerRegistry: Record<string, ProviderFactory> = {
	cloudflare: ({ env, transport, settings = websiteConfig.mail }) =>
		createMailProvider(
			mailConfigFromEnv(env, { ...settings, provider: "cloudflare" }),
			transport,
		),
	resend: ({ env, transport, settings = websiteConfig.mail }) =>
		createMailProvider(
			mailConfigFromEnv(env, { ...settings, provider: "resend" }),
			transport,
		),
};
export function getMailProvider(context: MailProviderContext): MailProvider {
	const settings = context.settings ?? websiteConfig.mail;
	if (!settings.enable)
		throw new ServiceError(
			"CONFIGURATION",
			"Mail is disabled in websiteConfig.",
		);
	const factory = Object.hasOwn(providerRegistry, settings.provider)
		? providerRegistry[settings.provider]
		: undefined;
	if (!factory)
		throw new ServiceError("CONFIGURATION", "Unknown mail provider");
	return factory({ ...context, settings });
}
/** Server-only convenience API matching the documented template/context call. */
export async function sendEmail(
	input: SendTemplateParams | RawEmail,
	context?: MailProviderContext,
): Promise<SendEmailResult> {
	if (!(context?.settings ?? websiteConfig.mail).enable)
		throw new ServiceError(
			"CONFIGURATION",
			"Mail is disabled in websiteConfig.",
		);
	const resolved = context ?? {
		env: (await import("../api/runtime.server")).bindings(),
	};
	const provider = getMailProvider(resolved);
	return "template" in input
		? provider.sendTemplate(input)
		: provider.sendRawEmail(input);
}
