import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiConfigFromEnv, createAiService } from "../src/ai/index.server";
import {
	dataImage,
	requestJson,
	type FetchTransport,
} from "../src/ai/http.server";
import {
	AI_CARDS,
	SPEECH_VOICES,
	TRANSLATION_LANGUAGES,
} from "../src/ai/types";
import {
	createMailProvider,
	renderAuthEmail,
	renderMailTemplate,
	sendMailFromEnv,
} from "../src/mail/index.server";
import {
	createNewsletterProvider,
	newsletterConfigFromEnv,
	withNewsletterStatusCache,
} from "../src/newsletter/index.server";
import {
	createFeishuSignature,
	createNotificationService,
} from "../src/notification/index.server";
const ACCOUNT = "a".repeat(32);
const CF = { accountId: ACCOUNT, apiToken: "cf-test-token" };
const PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
function stub(...responses: Response[]) {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const transport: FetchTransport = async (url, init) => {
		calls.push({ url, init: init ?? {} });
		const next = responses.shift();
		if (!next) throw new Error("Unexpected provider call");
		return next;
	};
	return {
		transport,
		calls,
		body: (index = 0) =>
			JSON.parse(String(calls[index].init.body)) as Record<string, unknown>,
	};
}
function falResponses(url = "https://fal.media/test.png", id = "request-1") {
	return [
		json({ request_id: id }),
		json({ status: "COMPLETED", request_id: id }),
		json({ images: [{ url, content_type: "image/png" }] }),
	];
}
const clefResult = () => ({
	model: "clef-flash",
	answers: {
		urgent: { type: "noul", noul: 0.9 },
		team: {
			type: "choice",
			choice: "technical",
			probabilities: { billing: 0.1, technical: 0.8, sales: 0.1 },
			confidence: 0.8,
		},
		severity: {
			type: "score",
			score: 2.7,
			legend: {
				"0": "None",
				"1": "Small inconvenience",
				"2": "Significant disruption",
				"3": "Complete outage",
			},
			probabilities: { "0": 0.05, "1": 0.05, "2": 0.05, "3": 0.85 },
			confidence: 0.85,
		},
	},
	usage: { input_tokens: 120, output_tokens: 0 },
});
beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Live network calls are forbidden in service tests");
		}),
	);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
describe("service transport", () => {
	it.each([
		"https://",
		"https://user:password@example.com",
		"javascript:alert(1)",
		"//relative.example.test",
	])(
		"rejects malformed or credential-bearing search URLs %s at the server boundary",
		async (url) => {
			const mock = stub(
				json({ result: { items: [{ url, title: "Fixture" }] } }),
			);
			await expect(
				createAiService({ cloudflare: CF }, mock.transport).webSearch({
					query: "hello",
				}),
			).rejects.toMatchObject({ code: "UPSTREAM" });
		},
	);

	it("does not leak provider response bodies or credentials", async () => {
		const mock = stub(
			json({ error: "secret-token sensitive-user-input" }, 500),
		);
		await expect(
			requestJson(mock.transport, "https://example.com", {}),
		).rejects.toMatchObject({
			code: "UPSTREAM",
			message: "Provider request failed (HTTP 500)",
		});
		expect(mock.calls).toHaveLength(1);
	});
	it("enforces response size limits", async () => {
		const mock = stub(new Response("x".repeat(100)));
		await expect(
			requestJson(mock.transport, "https://example.com", {
				maxResponseBytes: 10,
			}),
		).rejects.toThrow("size limit");
	});
	it("aborts timeout and never retries an uncertain request", async () => {
		vi.useFakeTimers();
		const transport: FetchTransport = vi.fn(
			async (_url, init) =>
				new Promise<Response>((_resolve, reject) =>
					init?.signal?.addEventListener("abort", () =>
						reject(new Error("Aborted")),
					),
				),
		);
		const pending = requestJson(transport, "https://example.com", {
			timeoutMs: 50,
		});
		const assertion = expect(pending).rejects.toMatchObject({
			code: "TIMEOUT",
		});
		await vi.advanceTimersByTimeAsync(51);
		await assertion;
		expect(transport).toHaveBeenCalledTimes(1);
	});
	it("rejects disguised or oversized uploaded images", () => {
		expect(dataImage(PNG)).toBe(PNG);
		expect(() => dataImage("data:image/png;base64,PHNjcmlwdD4=")).toThrow(
			"media type",
		);
		expect(() => dataImage(PNG, 10)).toThrow("exceeds");
		expect(() => dataImage("https://localhost/image.png")).toThrow(
			"Invalid image",
		);
	});
});
describe("AI adapters", () => {
	it("exposes all ten cards, ten languages, and eight voices without secrets", () => {
		expect(AI_CARDS).toHaveLength(10);
		expect(TRANSLATION_LANGUAGES).toHaveLength(10);
		expect(SPEECH_VOICES).toHaveLength(8);
	});
	it("uses canonical credentials before supported aliases", () => {
		const config = aiConfigFromEnv({
			CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
			CLOUDFLARE_AI_API_TOKEN: "least-privilege",
			CLOUDFLARE_API_TOKEN: "legacy",
			FAL_API_KEY: "canonical",
			FAL_KEY: "alias",
		});
		expect(config.cloudflare?.apiToken).toBe("least-privilege");
		expect(config.fal?.apiKey).toBe("canonical");
	});
	it("fails clearly without configuration and before any request", async () => {
		const mock = stub();
		await expect(
			createAiService({}, mock.transport).summarize(
				"This is a valid input to the summarization service, with enough characters.",
			),
		).rejects.toMatchObject({ code: "CONFIGURATION" });
		expect(mock.calls).toHaveLength(0);
	});
	it("uses Cloudflare search gateway, trims query and defaults to five results", async () => {
		const mock = stub(
			json({
				items: [
					{
						url: "https://example.com",
						title: "Example",
						description: "Source",
					},
				],
			}),
		);
		const result = await createAiService(
			{ cloudflare: CF },
			mock.transport,
		).webSearch({ query: "  edge compute  " });
		expect(result.items).toHaveLength(1);
		expect(mock.calls[0].url).toBe(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/websearch/`,
		);
		expect(mock.body()).toEqual({
			query: "edge compute",
			provider: "ceramic",
			limit: 5,
			options: { gateway: { id: "default" } },
		});
		expect(mock.calls[0].init.headers).toMatchObject({
			Authorization: "Bearer cf-test-token",
		});
	});
	it("rejects unsafe model overrides and search limits before spending", async () => {
		const mock = stub();
		const ai = createAiService({ cloudflare: CF }, mock.transport);
		await expect(
			ai.webSearch({ query: "hello", limit: 11 }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			ai.decide({
				text: "Broken checkout for all users",
				model: "../../anything" as "clef",
			}),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(mock.calls).toHaveLength(0);
	});
	it("returns actionable billing guidance on 402", async () => {
		const mock = stub(json({}, 402));
		await expect(
			createAiService({ cloudflare: CF }, mock.transport).webSearch({
				query: "test",
			}),
		).rejects.toThrow("AI Gateway");
	});
	it("uses typed Clef questions and returns real probabilities without invented severity labels", async () => {
		const mock = stub(json({ success: true, result: clefResult() }));
		const result = await createAiService(
			{ cloudflare: CF },
			mock.transport,
		).decide({ text: "Every checkout is failing", model: "clef-flash" });
		expect(result.answers.urgent.noul).toBe(0.9);
		expect(result.answers.team.probabilities.technical).toBe(0.8);
		expect(result.answers.severity.score).toBe(2.7);
		expect(result.usage.input_tokens).toBe(120);
		expect(mock.body()).toMatchObject({
			model: "clef-flash",
			questions: {
				urgent: { type: "noul" },
				team: { type: "choice" },
				severity: { type: "score" },
			},
		});
	});
	it.each(["noul", "missing-team", "distribution", "score", "usage"] as const)(
		"rejects malformed Clef %s rather than showing arbitrary model output",
		async (failure) => {
			const result = clefResult();
			if (failure === "noul") result.answers.urgent.noul = 2;
			if (failure === "missing-team")
				delete (
					result.answers.team.probabilities as Partial<
						typeof result.answers.team.probabilities
					>
				).sales;
			if (failure === "distribution")
				result.answers.team.probabilities.billing = 0.8;
			if (failure === "score") result.answers.severity.score = -1;
			if (failure === "usage") result.usage.input_tokens = -1;
			const mock = stub(json({ result }));
			await expect(
				createAiService({ cloudflare: CF }, mock.transport).decide({
					text: "Every checkout is failing",
					model: "clef-flash",
				}),
			).rejects.toMatchObject({ code: "UPSTREAM" });
		},
	);
	it("normalizes Gemma chat completions and validates summary input", async () => {
		const mock = stub(
			json({
				success: true,
				result: { choices: [{ message: { content: "A concise summary." } }] },
			}),
		);
		const ai = createAiService({ cloudflare: CF }, mock.transport);
		await expect(ai.summarize("Too short")).rejects.toThrow("50–500");
		await expect(
			ai.summarize(
				"This source passage contains enough detail to summarize, while fitting the configured demo limit.",
			),
		).resolves.toBe("A concise summary.");
		expect(mock.calls[0].url).toContain("@cf/google/gemma-4-26b-a4b-it");
	});
	it("translates with documented language codes", async () => {
		const mock = stub(
			json({ success: true, result: { translated_text: "你好" } }),
		);
		await expect(
			createAiService({ cloudflare: CF }, mock.transport).translate({
				text: "Hello",
				source: "en",
				target: "zh",
			}),
		).resolves.toBe("你好");
		expect(mock.body()).toEqual({
			text: "Hello",
			source_lang: "en",
			target_lang: "zh",
		});
	});
	it("validates five generated taglines rather than fabricating missing output", async () => {
		const mock = stub(
			json({ result: { response: '["One","Two","Three","Four","Five"]' } }),
			json({ result: { response: "invalid" } }),
		);
		const ai = createAiService({ cloudflare: CF }, mock.transport);
		await expect(ai.taglines("A helpful app for teams")).resolves.toHaveLength(
			5,
		);
		await expect(ai.taglines("A helpful app for teams")).rejects.toThrow(
			"invalid taglines",
		);
	});
	it("returns MP3 bytes without JSON parsing", async () => {
		const mock = stub(
			new Response(new Uint8Array([73, 68, 51, 0]), {
				headers: { "Content-Type": "audio/mpeg" },
			}),
		);
		const result = await createAiService(
			{ cloudflare: CF },
			mock.transport,
		).speak({ text: "Hello", voice: "luna" });
		expect(result.contentType).toBe("audio/mpeg");
		expect(result.bytes.length).toBe(4);
		expect(mock.body()).toEqual({
			text: "Hello",
			speaker: "luna",
			encoding: "mp3",
		});
	});
	it("sends vision input as data URI, not a remotely fetched user URL", async () => {
		const mock = stub(
			json({
				result: { choices: [{ message: { content: "A tiny image." } }] },
			}),
		);
		await expect(
			createAiService({ cloudflare: CF }, mock.transport).caption({
				image: PNG,
			}),
		).resolves.toBe("A tiny image.");
		expect(JSON.stringify(mock.body())).toContain("image_url");
	});
	it.each(["flux-2-klein-4b", "flux-2-klein-9b"] as const)(
		"uses real multipart form for %s",
		async (model) => {
			const mock = stub(json({ result: { image: "/9j/AA==" } }));
			await createAiService(
				{ cloudflare: CF },
				mock.transport,
			).generateWorkersImage({ prompt: "A calm beach", model });
			expect(mock.calls[0].init.body).toBeInstanceOf(FormData);
			expect((mock.calls[0].init.body as FormData).get("width")).toBe("1024");
			expect(mock.calls[0].init.headers).not.toHaveProperty("Content-Type");
		},
	);
	it("uses JSON for Schnell rather than unsupported Klein parameters", async () => {
		const mock = stub(json({ result: { image: "/9j/AA==" } }));
		await createAiService(
			{ cloudflare: CF },
			mock.transport,
		).generateWorkersImage({ prompt: "A calm beach", model: "flux-1-schnell" });
		expect(mock.body()).toEqual({ prompt: "A calm beach", steps: 4 });
	});
	it.each([
		["flux-schnell", "fal-ai/flux/schnell"],
		["nano-banana", "fal-ai/nano-banana"],
		["gpt-image-2", "openai/gpt-image-2"],
	] as const)(
		"routes fal model %s to a fixed approved endpoint",
		async (model, endpoint) => {
			const mock = stub(...falResponses());
			const result = await createAiService(
				{ fal: { apiKey: "fal-test" } },
				mock.transport,
			).generateFalImage({ prompt: "A calm beach", model });
			expect(mock.calls[0].url).toBe(`https://queue.fal.run/${endpoint}`);
			expect(mock.calls).toHaveLength(3);
			expect(mock.calls[1].url).toContain("/requests/request-1/status");
			expect(mock.body()).toMatchObject({
				prompt: "A calm beach",
				num_images: 1,
				output_format: "png",
			});
			expect(new Headers(mock.calls[0].init.headers).get("Authorization")).toBe(
				"Key fal-test",
			);
			expect(result.images[0].url).toBe("https://fal.media/test.png");
		},
	);
	it("edits avatars with the image-to-image endpoint", async () => {
		const mock = stub(...falResponses("https://fal.media/avatar.png"));
		await createAiService(
			{ fal: { apiKey: "fal-test" } },
			mock.transport,
		).editAvatar({ image: PNG, prompt: "Add a blue background" });
		expect(mock.calls[0].url).toBe(
			"https://queue.fal.run/fal-ai/nano-banana/edit",
		);
		expect(mock.body()).toMatchObject({
			image_urls: [PNG],
			limit_generations: true,
			num_images: 1,
		});
	});
	it("keeps concurrent TanStack fal credentials and transports request-scoped", async () => {
		const first = stub(...falResponses("https://fal.media/first.png", "first"));
		const second = stub(
			...falResponses("https://fal.media/second.png", "second"),
		);
		const results = await Promise.all([
			createAiService(
				{ fal: { apiKey: "first-key" } },
				first.transport,
			).generateFalImage({ prompt: "First illustration" }),
			createAiService(
				{ fal: { apiKey: "second-key" } },
				second.transport,
			).generateFalImage({
				prompt: "Second illustration",
				model: "nano-banana",
			}),
		]);
		expect(results[0].images[0].url).toContain("first.png");
		expect(results[1].images[0].url).toContain("second.png");
		expect(first.calls).toHaveLength(3);
		expect(second.calls).toHaveLength(3);
		for (const call of first.calls)
			expect(new Headers(call.init.headers).get("Authorization")).toBe(
				"Key first-key",
			);
		for (const call of second.calls)
			expect(new Headers(call.init.headers).get("Authorization")).toBe(
				"Key second-key",
			);
	});
	it("prevents fal SDK automatic submission retries and redacts upstream secrets", async () => {
		const mock = stub(json({ detail: "secret-key private portrait" }, 503));
		await expect(
			createAiService(
				{ fal: { apiKey: "test" } },
				mock.transport,
			).generateFalImage({ prompt: "A calm beach" }),
		).rejects.toMatchObject({
			code: "UPSTREAM",
			message: "Provider request failed (HTTP 503)",
		});
		expect(mock.calls).toHaveLength(1);
	});
	it("rejects a manipulated queue request ID before issuing a follow-up request", async () => {
		const mock = stub(json({ request_id: "../../secrets?key=stolen" }));
		await expect(
			createAiService(
				{ fal: { apiKey: "test" } },
				mock.transport,
			).generateFalImage({ prompt: "A calm beach" }),
		).rejects.toMatchObject({ code: "UPSTREAM" });
		expect(mock.calls).toHaveLength(1);
	});
	it("bounds TanStack fal execution and reports uncertain timeout without resubmitting", async () => {
		vi.useFakeTimers();
		const transport: FetchTransport = vi.fn(
			async (_url, init) =>
				new Promise<Response>((_resolve, reject) =>
					init?.signal?.addEventListener("abort", () =>
						reject(new Error("Aborted")),
					),
				),
		);
		const promise = createAiService(
			{ fal: { apiKey: "test" } },
			transport,
		).generateFalImage({ prompt: "A calm beach" });
		const assertion = expect(promise).rejects.toMatchObject({
			code: "TIMEOUT",
		});
		await vi.advanceTimersByTimeAsync(120_001);
		await assertion;
		expect(transport).toHaveBeenCalledTimes(1);
	});
});
describe("mail adapters and React Email", () => {
	it("uses Cloudflare REST as default, returns acknowledgement not delivery guarantee", async () => {
		const mock = stub(
			json({
				success: true,
				result: { message_id: "message-1", queued: ["user@example.com"] },
			}),
		);
		await expect(
			sendMailFromEnv(
				{
					CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
					CLOUDFLARE_EMAIL_API_TOKEN: "email-token",
					MAIL_FROM_EMAIL: "App <hello@example.com>",
				},
				{ to: "user@example.com", subject: "Welcome", html: "<p>Hello</p>" },
				mock.transport,
			),
		).resolves.toEqual({
			id: "message-1",
			provider: "cloudflare",
			accepted: true,
		});
		expect(mock.calls[0].url).toContain("/email/sending/send");
		expect(mock.calls[0].init.headers).toMatchObject({
			Authorization: "Bearer email-token",
		});
	});
	it("sends Resend idempotency keys and sanitized reply-to", async () => {
		const mock = stub(json({ id: "email-1" }));
		await createMailProvider(
			{ provider: "resend", apiKey: "re_test", from: "hello@example.com" },
			mock.transport,
		).sendRawEmail({
			to: "user@example.com",
			subject: "Hello",
			text: "Welcome",
			replyTo: "Support@Example.com",
			idempotencyKey: "auth-event-1",
		});
		expect(mock.calls[0].init.headers).toMatchObject({
			"Idempotency-Key": "auth-event-1",
		});
		expect(mock.body().reply_to).toBe("support@example.com");
	});
	it("rejects missing sender, header injection and bounced recipients", async () => {
		expect(() =>
			createMailProvider({ provider: "resend", apiKey: "key", from: "" }),
		).toThrow("MAIL_FROM_EMAIL");
		const mock = stub(
			json({
				success: true,
				result: { message_id: "x", permanent_bounces: ["user@example.com"] },
			}),
		);
		const mail = createMailProvider(
			{ provider: "cloudflare", ...CF, from: "hello@example.com" },
			mock.transport,
		);
		await expect(
			mail.sendRawEmail({
				to: "user@example.com",
				subject: "x\nBcc:bad@example.com",
				text: "Hello",
			}),
		).rejects.toThrow("single line");
		await expect(
			mail.sendRawEmail({
				to: "user@example.com",
				subject: "Hello",
				text: "Hello",
			}),
		).rejects.toThrow("bounced");
	});
	it.each(["verify", "reset", "delete"] as const)(
		"renders %s auth template with safe HTML and plain text",
		async (type) => {
			const result = await renderAuthEmail({
				type,
				name: "<script>alert(1)</script>",
				url: "https://example.com/action?token=example",
			});
			expect(result.html).toContain("&lt;script&gt;");
			expect(result.html).not.toContain("<script>alert");
			expect(result.text).toContain("https://example.com/action?token=example");
		},
	);
	it("renders newsletter and contact templates and blocks script links", async () => {
		await expect(
			renderMailTemplate({
				type: "subscribeNewsletter",
				name: "Ada",
				url: "https://example.com/confirm",
			}),
		).resolves.toMatchObject({
			subject: "Confirm your newsletter subscription",
		});
		const contact = await renderMailTemplate({
			type: "contactMessage",
			name: "Ada",
			email: "ada@example.com",
			message: "<img src=x onerror=alert(1)>",
		});
		expect(contact.html).toContain("&lt;img");
		await expect(
			renderAuthEmail({
				type: "verify",
				name: "Ada",
				url: "javascript:alert(1)",
			}),
		).rejects.toThrow("HTTPS");
	});
});
describe("newsletter adapters", () => {
	it("uses the actual MailCheap provider, not Mailchimp", () => {
		expect(
			newsletterConfigFromEnv(
				{ MAILCHEAP_API_KEY: "key", MAILCHEAP_NEWSLETTER_ID: "weekly" },
				{ enabled: true, provider: "mailcheap", autoSubscribe: false },
			),
		).toEqual({ provider: "mailcheap", apiKey: "key", newsletterId: "weekly" });
		expect(() =>
			newsletterConfigFromEnv(
				{},
				{
					enabled: true,
					provider: "mailchimp" as "mailcheap",
					autoSubscribe: false,
				},
			),
		).toThrow("mailcheap");
	});
	it("requires explicit consent before mutating an external contact", async () => {
		const mock = stub();
		const provider = createNewsletterProvider(
			{ provider: "resend", apiKey: "re_test" },
			mock.transport,
		);
		await expect(
			provider.subscribe({ email: "a@example.com", consent: false as true }),
		).rejects.toThrow("consent");
		expect(mock.calls).toHaveLength(0);
	});
	it("creates Resend contact after a real 404 and does not mistake auth failures for missing contacts", async () => {
		const mock = stub(json({}, 404), json({ id: "contact-1" }), json({}, 401));
		const provider = createNewsletterProvider(
			{ provider: "resend", apiKey: "re_test" },
			mock.transport,
		);
		await expect(
			provider.subscribe({ email: "Ada@Example.com", consent: true }),
		).resolves.toBe(true);
		expect(mock.body(1)).toEqual({
			email: "ada@example.com",
			unsubscribed: false,
		});
		await expect(
			provider.checkSubscribeStatus({ email: "ada@example.com" }),
		).rejects.toMatchObject({ status: 401 });
	});
	it("does not silently resubscribe a previously unsubscribed Resend contact", async () => {
		const mock = stub(json({ id: "contact", unsubscribed: true }));
		await expect(
			createNewsletterProvider(
				{ provider: "resend", apiKey: "key" },
				mock.transport,
			).subscribe({ email: "a@example.com", consent: true }),
		).resolves.toBe(false);
		expect(mock.calls).toHaveLength(1);
	});
	it("unsubscribes Beehiiv via update, never irreversible DELETE", async () => {
		const mock = stub(json({ data: { id: "sub_1234", status: "inactive" } }));
		await expect(
			createNewsletterProvider(
				{ provider: "beehiiv", apiKey: "key", publicationId: "pub_1234-5678" },
				mock.transport,
			).unsubscribe({ email: "a@example.com" }),
		).resolves.toBe(true);
		expect(mock.calls[0].init.method).toBe("PUT");
		expect(mock.body()).toEqual({ unsubscribe: true });
	});
	it("preserves Beehiiv publication double-opt-in settings", async () => {
		const mock = stub(json({ data: { id: "sub_1234", status: "validating" } }));
		await expect(
			createNewsletterProvider(
				{ provider: "beehiiv", apiKey: "key", publicationId: "pub_1234" },
				mock.transport,
			).subscribe({ email: "a@example.com", consent: true }),
		).resolves.toBe(true);
		expect(mock.body()).toMatchObject({
			reactivate_existing: false,
			double_opt_override: "not_set",
			send_welcome_email: false,
		});
	});
	it("scopes MailCheap contact status operations to the configured newsletter", async () => {
		const mock = stub(
			json({ id: "1", status: "pending" }),
			json({ id: "1", status: "active" }),
			json({ id: "1", status: "unsubscribed" }),
		);
		const provider = createNewsletterProvider(
			{ provider: "mailcheap", apiKey: "mc_test", newsletterId: "weekly" },
			mock.transport,
		);
		await expect(
			provider.subscribe({ email: "a@example.com", consent: true }),
		).resolves.toBe(true);
		expect(mock.body()).toMatchObject({
			newsletter: "weekly",
			resubscribe: false,
		});
		await expect(
			provider.checkSubscribeStatus({ email: "a@example.com" }),
		).resolves.toBe(true);
		expect(mock.calls[1].url).toBe(
			"https://mailcheap.ai/api/v1/contacts/a%40example.com?newsletter=weekly",
		);
		await expect(
			provider.unsubscribe({ email: "a@example.com" }),
		).resolves.toBe(true);
		expect(mock.body(2)).toEqual({
			newsletter: "weekly",
			status: "unsubscribed",
		});
	});
	it("invalidates hashed status cache on writes and never caches an upstream failure", async () => {
		const data = new Map<string, string>();
		const cache = {
			get: vi.fn(async (key: string) => data.get(key) ?? null),
			put: vi.fn(async (key: string, value: string) => {
				data.set(key, value);
			}),
			delete: vi.fn(async (key: string) => {
				data.delete(key);
			}),
		};
		const source = {
			getProviderName: () => "resend" as const,
			subscribe: vi.fn(async () => true),
			unsubscribe: vi.fn(async () => true),
			checkSubscribeStatus: vi.fn(async () => true),
		};
		const provider = withNewsletterStatusCache(source, cache, "test-account");
		await provider.checkSubscribeStatus({ email: "a@example.com" });
		await provider.checkSubscribeStatus({ email: "a@example.com" });
		expect(source.checkSubscribeStatus).toHaveBeenCalledTimes(1);
		expect([...data.keys()][0]).not.toContain("@");
		await provider.unsubscribe({ email: "a@example.com" });
		expect(data.size).toBe(0);
	});
});
describe("payment notifications", () => {
	const input = {
		sessionId: "cs_123",
		customerId: "cus_123",
		userName: "@everyone",
		amount: 1999,
		currency: "usd",
	};
	const discordWebhookUrl = "https://discord.com/api/webhooks/123/test-token";
	const feishuWebhookUrl =
		"https://open.feishu.cn/open-apis/bot/v2/hook/test-token";
	it("restricts destinations to provider webhook origins", () => {
		expect(() =>
			createNotificationService({
				discordWebhookUrl: "https://evil.example/token",
			}),
		).toThrow("Invalid discord");
		expect(() => createNotificationService({})).toThrow("Configure");
	});
	it("uses green Discord fields, correct money and disabled mentions", async () => {
		const mock = stub(json({ id: "notification-1" }));
		await expect(
			createNotificationService(
				{ discordWebhookUrl },
				mock.transport,
			).sendPaymentNotification(input),
		).resolves.toEqual([{ channel: "discord", accepted: true }]);
		expect(mock.body()).toMatchObject({
			allowed_mentions: { parse: [] },
			embeds: [
				{
					color: 0x2ecc71,
					fields: expect.arrayContaining([
						{ name: "Configured plan price", value: "$19.99", inline: true },
					]),
				},
			],
		});
		expect(mock.calls[0].url).toContain("?wait=true");
		expect(JSON.stringify(mock.body())).toContain("Payment access updated");
		expect(JSON.stringify(mock.body())).not.toContain("Payment received");
	});
	it("signs Feishu payload and surfaces semantic HTTP-200 errors", async () => {
		const mock = stub(json({ code: 19021, msg: "wrong signature" }));
		const deliveries = await createNotificationService(
			{ feishuWebhookUrl, feishuSecret: "secret" },
			mock.transport,
			() => 1_700_000_000_000,
		).sendPaymentNotification(input);
		expect(mock.body()).toMatchObject({
			timestamp: "1700000000",
			sign: await createFeishuSignature("secret", 1_700_000_000),
			msg_type: "text",
		});
		expect(deliveries).toEqual([
			{
				channel: "feishu",
				accepted: false,
				error: "Feishu rejected the notification",
			},
		]);
	});
	it("contains optional notification failures without retrying payment side effects", async () => {
		const mock = stub(json({}, 500), json({ code: 0 }));
		const deliveries = await createNotificationService(
			{ discordWebhookUrl, feishuWebhookUrl },
			mock.transport,
		).sendPaymentNotification(input);
		expect(deliveries.map((entry) => entry.accepted)).toEqual([false, true]);
		expect(mock.calls).toHaveLength(2);
	});
});
