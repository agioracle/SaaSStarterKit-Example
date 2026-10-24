import "@tanstack/react-start/server-only";
import { createElement, type ComponentType } from "react";
import { render, toPlainText } from "react-email";
import { emailInput, ServiceError, textInput } from "../ai/http.server";
import type { MailTemplate, RenderedEmail, SendTemplateParams } from "./types";
import {
	ContactMessageEmail,
	DeleteAccountEmail,
	ForgotPasswordEmail,
	SubscribeNewsletterEmail,
	VerifyEmail,
} from "./templates";

/** Explicitly English, matching the existing transactional email contract. */
export const EmailSubjects: Record<string, string> = {
	forgotPassword: "Reset your password",
	verifyEmail: "Verify your email address",
	deleteAccount: "Confirm account deletion",
	subscribeNewsletter: "Confirm your newsletter subscription",
	contactMessage: "New contact message",
};
export const EmailTemplates: Record<string, ComponentType<any>> = {
	forgotPassword: ForgotPasswordEmail,
	verifyEmail: VerifyEmail,
	deleteAccount: DeleteAccountEmail,
	subscribeNewsletter: SubscribeNewsletterEmail,
	contactMessage: ContactMessageEmail,
};
function actionUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new ServiceError("VALIDATION", "Invalid email action URL");
	}
	if (
		url.username ||
		url.password ||
		(url.protocol !== "https:" &&
			!(
				url.protocol === "http:" &&
				["localhost", "127.0.0.1"].includes(url.hostname)
			))
	)
		throw new ServiceError("VALIDATION", "Email action URL must be HTTPS");
	return url.toString();
}
export async function renderEmail(
	input: Pick<SendTemplateParams, "template" | "context">,
): Promise<RenderedEmail> {
	const { template, context } = input;
	if (
		!Object.hasOwn(EmailTemplates, template) ||
		!Object.hasOwn(EmailSubjects, template)
	)
		throw new ServiceError("VALIDATION", "Unknown email template");
	const props: Record<string, unknown> = { ...context };
	if (
		[
			"forgotPassword",
			"verifyEmail",
			"deleteAccount",
			"subscribeNewsletter",
			"contactMessage",
		].includes(template)
	) {
		props.name = textInput(props.name || "there", "Name", 1, 100);
		if (template === "contactMessage") {
			props.email = emailInput(props.email);
			props.message = textInput(props.message, "Contact message", 1, 10_000);
		} else props.url = actionUrl(String(props.url ?? ""));
	}
	const html = await render(createElement(EmailTemplates[template], props));
	return { subject: EmailSubjects[template], html, text: toPlainText(html) };
}
export function renderMailTemplate(
	template: MailTemplate,
): Promise<RenderedEmail> {
	const { type, ...context } = template;
	return renderEmail({ template: type, context });
}
export function renderAuthEmail(input: {
	type: "verify" | "reset" | "delete";
	name: string;
	url: string;
}): Promise<RenderedEmail> {
	return renderMailTemplate({
		type:
			input.type === "verify"
				? "verifyEmail"
				: input.type === "reset"
					? "forgotPassword"
					: "deleteAccount",
		name: input.name,
		url: input.url,
	});
}
