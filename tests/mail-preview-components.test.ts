import { createElement, type ReactNode } from "react";
import { render } from "react-email";
import { describe, expect, it, vi } from "vitest";
import ContactMessageEmail from "../src/mail/templates/contact-message";
import DeleteAccountEmail from "../src/mail/templates/delete-account";
import ForgotPasswordEmail from "../src/mail/templates/forgot-password";
import SubscribeNewsletterEmail from "../src/mail/templates/subscribe-newsletter";
import VerifyEmail from "../src/mail/templates/verify-email";

// Replacing the public composition components must affect the actual templates,
// not only a second preview-only implementation or the public export barrel.
vi.mock("../src/mail/components/email-layout", () => ({
	default: ({ children, title }: { children: ReactNode; title: string }) =>
		createElement("section", { "data-shared-mail-layout": title }, children),
}));
vi.mock("../src/mail/components/email-button", () => ({
	default: ({ children, href }: { children: ReactNode; href: string }) =>
		createElement("a", { "data-shared-mail-button": "true", href }, children),
}));

describe("shared public email composition", () => {
	it.each([
		["verify", VerifyEmail],
		["forgot-password", ForgotPasswordEmail],
		["delete-account", DeleteAccountEmail],
		["newsletter", SubscribeNewsletterEmail],
	] as const)(
		"renders %s through the public layout and button",
		async (_name, component) => {
			const html = await render(
				createElement(component, component.PreviewProps),
			);
			expect(html).toContain("data-shared-mail-layout");
			expect(html).toContain('data-shared-mail-button="true"');
			expect(html).toContain("https://example.invalid/preview-only");
		},
	);
	it("renders contact messages through the public layout without an action button", async () => {
		const html = await render(
			createElement(ContactMessageEmail, ContactMessageEmail.PreviewProps),
		);
		expect(html).toContain('data-shared-mail-layout="New contact message"');
		expect(html).toContain("reader@example.invalid");
		expect(html).not.toContain("data-shared-mail-button");
	});
});
