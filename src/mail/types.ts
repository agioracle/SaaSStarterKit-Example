export interface MailProviderNames {
	cloudflare: true;
	resend: true;
}
export type MailProviderName = keyof MailProviderNames;
export type MailConfig =
	| {
			provider: "cloudflare";
			accountId: string;
			apiToken: string;
			from: string;
	  }
	| { provider: "resend"; apiKey: string; from: string };
export interface RawEmail {
	to: string;
	subject: string;
	html?: string;
	text?: string;
	replyTo?: string;
	idempotencyKey?: string;
}
export interface MailDelivery {
	id: string;
	provider: MailProviderName;
	accepted: true;
}
export type MailTemplate =
	| {
			type: "forgotPassword" | "verifyEmail" | "deleteAccount";
			name: string;
			url: string;
	  }
	| { type: "subscribeNewsletter"; name: string; url: string }
	| { type: "contactMessage"; name: string; email: string; message: string };
export interface RenderedEmail {
	subject: string;
	html: string;
	text: string;
}
export interface MailProvider {
	getProviderName(): string;
	sendRawEmail(message: RawEmail): Promise<MailDelivery>;
	sendTemplate(
		input: LegacySendTemplateParams | SendTemplateParams,
	): Promise<MailDelivery>;
}

/** Optional stronger context typing. Adding only a public union member is also supported. */
export interface EmailTemplateContexts {
	forgotPassword: { name: string; url: string };
	verifyEmail: { name: string; url: string };
	deleteAccount: { name: string; url: string };
	subscribeNewsletter: { name: string; url: string };
	contactMessage: { name: string; email: string; message: string };
}
/** Public editable union. Custom context augmentation remains optional. */
export type EmailTemplate =
	| "forgotPassword"
	| "verifyEmail"
	| "deleteAccount"
	| "subscribeNewsletter"
	| "contactMessage"
	| keyof EmailTemplateContexts;
export type EmailTemplateContext<Name extends string> =
	Name extends keyof EmailTemplateContexts
		? EmailTemplateContexts[Name]
		: Record<string, unknown>;
export type SendTemplateParams = {
	[Name in EmailTemplate]: {
		to: string;
		template: Name;
		context: EmailTemplateContext<Name>;
		replyTo?: string;
	};
}[EmailTemplate];
export interface LegacySendTemplateParams {
	to: string;
	template: MailTemplate;
	replyTo?: string;
}
export type SendRawEmailParams = RawEmail;
/** Includes an acknowledgement id; it does not assert final delivery. */
export type SendEmailResult = MailDelivery;
