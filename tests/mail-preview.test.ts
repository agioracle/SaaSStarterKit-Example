import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { render, toPlainText } from "react-email";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailSubjects, EmailTemplates, renderEmail } from "../src/mail/render";
import {
	ContactMessageEmail as LegacyContactMessageEmail,
	DeleteAccountEmail as LegacyDeleteAccountEmail,
	ForgotPasswordEmail as LegacyForgotPasswordEmail,
	SubscribeNewsletterEmail as LegacySubscribeNewsletterEmail,
	VerifyEmail as LegacyVerifyEmail,
} from "../src/mail/templates";
import ContactMessageEmail from "../src/mail/templates/contact-message";
import DeleteAccountEmail from "../src/mail/templates/delete-account";
import ForgotPasswordEmail from "../src/mail/templates/forgot-password";
import SubscribeNewsletterEmail from "../src/mail/templates/subscribe-newsletter";
import VerifyEmail from "../src/mail/templates/verify-email";
import type { SendTemplateParams } from "../src/mail/types";

vi.mock("@tanstack/react-start/server-only", () => ({}));

const legacy = {
	ContactMessageEmail: LegacyContactMessageEmail,
	DeleteAccountEmail: LegacyDeleteAccountEmail,
	ForgotPasswordEmail: LegacyForgotPasswordEmail,
	SubscribeNewsletterEmail: LegacySubscribeNewsletterEmail,
	VerifyEmail: LegacyVerifyEmail,
};
const templates = [
	[
		"contact-message",
		"contactMessage",
		"ContactMessageEmail",
		ContactMessageEmail,
	],
	["delete-account", "deleteAccount", "DeleteAccountEmail", DeleteAccountEmail],
	[
		"forgot-password",
		"forgotPassword",
		"ForgotPasswordEmail",
		ForgotPasswordEmail,
	],
	[
		"subscribe-newsletter",
		"subscribeNewsletter",
		"SubscribeNewsletterEmail",
		SubscribeNewsletterEmail,
	],
	["verify-email", "verifyEmail", "VerifyEmail", VerifyEmail],
] as const;
const templateDir = fileURLToPath(
	new URL("../src/mail/templates/", import.meta.url),
);

beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Preview tests must never call a provider");
		}),
	);
});
afterEach(() => vi.unstubAllGlobals());

describe("canonical email preview contract", () => {
	it("scans the documented source directory rather than preview-only wrappers", () => {
		const packageJson = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		);
		expect(packageJson.scripts["email:dev"]).toBe(
			"email dev --dir src/mail/templates --port 3001",
		);
		expect(packageJson.devDependencies["@react-email/ui"]).toBe(
			packageJson.dependencies["react-email"],
		);
		// The installed React Email CLI accepts these extensions and export patterns.
		// index.ts deliberately cannot match, even though it re-exports defaults.
		const discovered = readdirSync(templateDir).filter((filename) => {
			if (!/\.(js|jsx|tsx)$/.test(filename)) return false;
			const source = readFileSync(`${templateDir}/${filename}`, "utf8");
			return (
				/\bexport\s+default\b/gm.test(source) ||
				/\bmodule\.exports\s*=/gm.test(source) ||
				/\bexport\s+\{[^}]*\bdefault\b[^}]*\}/gm.test(source)
			);
		});
		expect(discovered).toEqual(
			expect.arrayContaining(templates.map(([filename]) => `${filename}.tsx`)),
		);
		expect(discovered).not.toContain("index.tsx");
		expect(discovered).not.toContain("email-layout.tsx");
		expect(discovered).not.toContain("action-email.tsx");
		expect(readdirSync(templateDir)).toContain("index.ts");
		expect(existsSync(new URL("../emails/", import.meta.url))).toBe(false);
	});

	it.each(templates)(
		"uses one %s component for preview, registry and historical imports",
		async (_filename, template, legacyName, component) => {
			expect(EmailTemplates[template]).toBe(component);
			expect(legacy[legacyName]).toBe(component);
			const props = component.PreviewProps;
			expect(props.name).toBe("Preview Reader");
			if ("url" in props) {
				const url = new URL(props.url);
				expect(url.hostname).toBe("example.invalid");
				expect(url.search).toBe("");
				expect(url.hash).toBe("");
			} else {
				expect(props.email).toBe("reader@example.invalid");
			}
			const html = await render(createElement(EmailTemplates[template], props));
			const runtime = await renderEmail({
				template,
				context: props,
			} as SendTemplateParams);
			expect(runtime).toEqual({
				subject: EmailSubjects[template],
				html,
				text: toPlainText(html),
			});
			expect(html).toContain("Preview Reader");
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it("does not substitute preview fixtures into runtime messages", async () => {
		const result = await renderEmail({
			template: "verifyEmail",
			context: {
				name: "Actual Runtime Context",
				url: "https://app.example.invalid/verify",
			},
		});
		expect(result.html).toContain("Actual Runtime Context");
		expect(result.html).toContain("https://app.example.invalid/verify");
		expect(result.html).not.toContain("Preview Reader");
		expect(result.html).not.toContain("https://example.invalid/preview-only");
	});
});
