# Server-side service adapters

These are independently implemented, documentation-based adapters, not the private TanStarter source. Provider contracts were checked on 2026-10-24. The local test suite uses injected transport exclusively: **no production email, newsletter changes, webhook messages, model inference, paid requests, account changes, or deployment were executed.** A passing mocked test is not a live provider certification.

## Integration contract

- `src/ai/index.server.ts`: `createAiService(AiConfig, transport?)`, `aiConfigFromEnv(env)`; the ten operation signatures and client-safe catalogue are in `src/ai/types.ts`.
- `src/mail/index.server.ts`: `createMailProvider(MailConfig, transport?)`, `sendMailFromEnv(env, message, transport?)`, async `renderAuthEmail({ type, name, url })`, and `renderMailTemplate(template)`.
- `src/newsletter/index.server.ts`: application code uses `createConfiguredNewsletterProvider(env, transport?)`, which applies the selected provider, enable flag, and optional KV cache with `websiteConfig.cache.ttl`. Lower-level `createNewsletterProvider(NewsletterConfig, transport?)`, `newsletterConfigFromEnv(env)`, and `withNewsletterStatusCache(provider, cache, accountAndListNamespace, ttlSeconds?)` remain available for explicit adapter composition.
- `src/notification/index.server.ts`: `createNotificationService(config, transport?, now?)`, `sendPaymentNotification(env, input, transport?)`.
- `src/ai/http.server.ts`: injected fetch transport and `ServiceError`. Its TanStack server-only marker also guards all importing implementations. Client modules should import only `index.ts` or `types.ts`.

Factories do not contact providers. Operations validate input before requests and throw explicit configuration errors when credentials are missing. Transport applies timeouts, limits response size, disallows redirects, redacts upstream response bodies from errors, and never automatically retries a possibly completed paid/send operation. Authentication, CSRF checks, abuse rate limits, quotas, and application authorization belong in the calling route, not in a provider adapter.

## Configuration

Secrets are server-only, never `VITE_*` variables.

| Service | Configuration |
| --- | --- |
| Workers AI | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_API_TOKEN`; legacy `CLOUDFLARE_API_TOKEN` fallback |
| Web search | Same AI credentials plus optional `CLOUDFLARE_AI_GATEWAY_ID` (default `default`) and `CLOUDFLARE_WEBSEARCH_BYOK_ALIAS` |
| fal.ai | `FAL_API_KEY`; `FAL_KEY` compatibility alias |
| Mail | `websiteConfig.mail.enable/provider/fromEmail/supportEmail`; provider defaults to `cloudflare`. Empty configured sender uses `MAIL_FROM_EMAIL`, then `MAIL_FROM`; empty support recipient uses `MAIL_SUPPORT_EMAIL`. |
| Cloudflare Email | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`; legacy `CLOUDFLARE_API_TOKEN` fallback |
| Resend mail/newsletter | `RESEND_API_KEY` |
| Newsletter | `websiteConfig.newsletter.enabled/provider/autoSubscribe`; provider defaults to `resend`, alternatives `beehiiv` and `mailcheap`. Resend uses account-level Contacts and needs no audience ID. |
| Beehiiv | `BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID` |
| MailCheap | `MAILCHEAP_API_KEY` with Full access, `MAILCHEAP_NEWSLETTER_ID` (ID or slug) |
| Notifications | `websiteConfig.notification.enabled/provider` selects exactly one of `discord` or `feishu`; only the selected `DISCORD_WEBHOOK_URL` or `FEISHU_WEBHOOK_URL` is required. Optional `FEISHU_WEBHOOK_SECRET`. |

Migration: provider selection is owned by `src/config/website.ts`. Remove old `MAIL_PROVIDER` and `NEWSLETTER_PROVIDER` values from local vars and Worker vars; they no longer override the configured provider, even if present. Keep credentials in Worker bindings. A missing selected-provider credential is an explicit error, never a fallback to another provider. Changing a feature selector requires rebuilding the application. Disabled mail rejects with a configuration error (the contact API returns 503); disabled newsletter rejects (the API returns 404). Disabled payment notifications return an empty delivery list without contacting a provider or claiming acceptance.

Mail addresses configured in `websiteConfig` take precedence over runtime aliases. `mail.supportEmail` defaults to public `VITE_SUPPORT_EMAIL`; set it independently for a distinct contact recipient. Sender and support addresses serve different roles. `websiteConfig.cache.ttl` is the newsletter status expiration in seconds, currently validated to 60–3600 when KV caching is active. Disabled/missing KV bypasses caching, and KV read/write failure falls back to the provider.

Public canonical URLs use `VITE_BASE_URL`, then the legacy `VITE_APP_URL`, then `http://localhost:3000`. Keep the effective value consistent with runtime `APP_URL`. Localized site name/title/description come from `messages/en.json` and `messages/zh.json` via request-local metadata helpers, not duplicate hardcoded configuration fields.

No Workers AI or Email binding is required. Use dedicated tokens with only the provider permissions needed. Search requires Workers AI Read and AI Gateway Read, and either gateway credits or a configured provider key. Omitting a BYOK alias allows Cloudflare's default alias/credit selection; supplying an alias makes missing-key failure explicit. Account entitlement, verified sending domains, billing balances, and provider permissions still need deployment-time verification.

## AI implementation

All ten documented playground categories have adapters: web search, decision, summary, translation, five taglines, MP3 speech, image caption, Workers image generation, fal image generation, and avatar editing. Search supports Ceramic/Exa/Linkup. Clef supports standard and Flash models. Gemma 4 is used for summaries, taglines, and captioning. Translation uses M2M100 with a ten-language allowlist. Aura 2 exposes the eight documented voices. FLUX Klein 4B/9B uses actual multipart encoding; Schnell uses JSON. fal endpoints cover Flux Schnell, Nano Banana, GPT Image 2, and Nano Banana editing.

Input limits are enforced on the server. Caption images are inline PNG/JPEG/WebP up to 1 MiB; avatar inputs up to 5 MiB. Remote input image URLs are intentionally unsupported to avoid SSRF and cross-user content leakage. Uploaded content is checked against its declared media signature. Model outputs remain untrusted content and should be rendered as text, never raw HTML. Clef probabilities and scores are model predictions, not support severity facts.

The ten translation choices, additional conservative validation limits, authentication/quota policy, and full prompts are independent implementation choices where the public reference does not specify exact private-source behavior. The fal generation and avatar-editing operations use the actual `generateImage` orchestration from `@tanstack/ai` with `FalImageAdapter` / `falImage` from `@tanstack/ai-fal` (installed v1). Their SDK executes queue submission, status polling, and result retrieval, not the previous synchronous HTTP shortcut. A request-scoped adapter wrapper avoids the SDK singleton credential race across concurrent requests. Injected SDK fetch is allowlisted to fal queue endpoints, bounds response sizes, forwards cancellation, and converts failures to sanitized non-retryable errors before the SDK can resubmit a paid operation. Execution is bounded at 120 seconds; timeout does not prove cancellation or absence of provider charges. The Worker API persists a returned fal queue job ID before polling and protects initial dispatch with a durable bounded reservation. Automatic durable resumption is not implemented, so never blindly retry an uncertain timeout. See [bounded usage policy](./USAGE_POLICY.md) for the disabled default, stable request IDs, outcome/retention contract and explicit limitations. `debug: false` prevents SDK error/prompt console logging. No SDK or credential is imported by the client-side catalogue.

Workers AI operations intentionally retain direct REST with no binding, including typed Clef/search endpoints, model-specific multipart FLUX, and binary Aura speech. The public reference specifies deep TanStack fal integration but does not expose its private orchestration implementation for these other operations; this does not claim exact internal source parity.

Clef results are parsed against the current official response schema rather than returned as arbitrary objects: `answers.urgent = { type: 'noul', noul }`, `answers.team = { type: 'choice', choice, probabilities, confidence }`, `answers.severity = { type: 'score', score, legend, probabilities, confidence }`, plus token `usage`. Probability values, expected option/level keys, normalization within rounding tolerance, selected option, weighted score, and token counts are validated. The three-team/four-level rubric is this implementation's explicit choice, not an assertion about hidden reference source.

Sources:
- [TanStarter AI](https://docs.tanstarter.dev/ai/)
- [Cloudflare Web Search contract](https://developers.cloudflare.com/web-search/how-to-use/)
- [Clef](https://developers.cloudflare.com/workers-ai/models/clef/)
- [Gemma 4](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)
- [M2M100](https://developers.cloudflare.com/workers-ai/models/m2m100-1.2b/)
- [Aura 2](https://developers.cloudflare.com/workers-ai/models/aura-2-en/)
- [FLUX Klein 4B multipart](https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/)
- [FLUX Klein 9B multipart](https://developers.cloudflare.com/changelog/post/2026-01-28-flux-2-klein-9b-workers-ai/)
- [FLUX Schnell](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/)
- [TanStack fal adapter](https://tanstack.com/ai/latest/docs/adapters/fal)
- [TanStack image generation](https://tanstack.com/ai/latest/docs/media/image-generation)
- [Clef official output JSON schema](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/clef.json)
- [fal queue lifecycle](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [fal Nano Banana editing](https://fal.ai/models/fal-ai/nano-banana/edit/api)
- [fal GPT Image 2](https://fal.ai/models/openai/gpt-image-2/api)

## Email, newsletter, and notifications

Mail supports Cloudflare Email REST (default) and Resend. English React Email templates cover password reset, verification, newsletter confirmation, and contact messages; account deletion is an application extension. HTML and plain text are generated together. Template interpolation escapes user content; action links reject unsafe URL schemes. A returned message ID means the provider accepted a request, not guaranteed inbox delivery. Immediate Cloudflare bounce/suppression results are treated as failures.

Newsletter providers implement `getProviderName`, `subscribe`, `unsubscribe`, and `checkSubscribeStatus`. Explicit `consent: true` is mandatory. Existing unsubscribed contacts are not reactivated unless `resubscribe: true` reflects a fresh user decision. `subscribe() === true` means the request was accepted, not that double opt-in completed. Status checks remain false while confirmation is pending. Beehiiv uses `PUT .../subscriptions/by_email/{email}` with `unsubscribe: true`, never destructive deletion. MailCheap is its own service at mailcheap.ai, **not Mailchimp**. Cache keys hash email with the account/list namespace, and writes invalidate cached status. KV remains eventually consistent and must not be used as an authorization source.

Payment notifications restrict destinations to Discord/Feishu/Lark webhook hosts. Discord includes structured green fields and disables automatic mentions; Feishu uses plain text and optional HMAC signing. `amount` is integer minor currency units and `currency` is an ISO-style three-letter code. The default heading is “Payment access updated” and the amount is labeled “Configured plan price”, because a catalogue price is not proof of the actual charge after tax or discounts. Callers may use `amountLabel: "Amount paid"` only with verified transaction amounts. The service returns separate delivery outcomes; an optional notification failure must not replay payment fulfillment. No notification is a payment receipt or proof of settlement.

Sources:
- [TanStarter mail](https://docs.tanstarter.dev/email/), [newsletter](https://docs.tanstarter.dev/newsletter/), [notifications](https://docs.tanstarter.dev/notification/)
- [Cloudflare Email REST](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
- [Cloudflare Email response](https://developers.cloudflare.com/api/resources/email_sending/methods/send/)
- [Resend send email](https://resend.com/docs/api-reference/emails/send-email)
- [React Email render](https://react.email/docs/utilities/render)
- [Resend create contact](https://resend.com/docs/api-reference/contacts/create-contact), [retrieve](https://resend.com/docs/api-reference/contacts/get-contact), [update](https://resend.com/docs/api-reference/contacts/update-contact)
- [Beehiiv create subscription](https://developers.beehiiv.com/api-reference/subscriptions/create), [retrieve by email](https://developers.beehiiv.com/api-reference/subscriptions/get-by-email), [update by email](https://developers.beehiiv.com/api-reference/subscriptions/update-by-email)
- [MailCheap authentication](https://mailcheap.ai/docs/authentication), [API](https://mailcheap.ai/docs/api), [machine-readable OpenAPI](https://mailcheap.ai/api/v1/openapi.json)
- [Discord webhook API](https://docs.discord.com/developers/resources/webhook)
- [Feishu custom bot signing](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)

## Verification

Run `npm test -- --run tests/services.test.ts` for transport-contract, validation, consent, template rendering, and notification tests. Live credentials must be tested separately in isolated non-production provider accounts with explicit operator authorization. This repository does not fabricate successful provider responses when configuration or network access is absent.
