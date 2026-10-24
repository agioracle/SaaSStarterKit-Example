# AI model configuration and safe diagnostics

## Public configuration entry

Edit and import the client-safe model configuration at `src/config/ai-models.ts`.
That documented file owns the actual constants consumed by adapters, task schemas,
and capacity policy. `src/ai/models.ts` is only a backward-compatible re-export;
`src/ai/types.ts`, `src/ai/index.ts`, and `src/ai/policy.ts` also reference the same
public values rather than keeping copies. Editing the public file changes both
UI selections and actual server execution, not merely a disconnected facade.

The registry owns:

- `SEARCH_PROVIDERS`, `DECISION_MODELS`, `TRANSLATION_LANGUAGES`, `SPEECH_VOICES`,
  `WORKERS_IMAGE_MODELS`, and `FAL_IMAGE_MODELS`, used by API validation and UI options.
- `AI_DEFAULT_MODELS`, used by server adapters and usage admission. Defaults select
  the first item of the corresponding catalogue. Reordering a catalogue therefore
  deliberately changes its default; update regression expectations with it.
- `AI_PROVIDER_MODELS`, used for Workers AI and fal model IDs. Types remain literal
  so the installed fal adapter can type-check model-specific options.
- `AI_MODEL_UNITS`, the relative admission weights. These are neither money,
  subscription credits, provider prices, nor a guaranteed spend cap.

No runtime credentials, account IDs, tenant settings, or network clients belong
in this module. Keep those in `AiConfig`/Worker bindings. AI stays disabled until
the site owner explicitly enables the bounded policy in `websiteConfig.ai`.

To add a model, update the registry and its capacity weight, implement or review
its adapter input/output contract, and extend offline transport tests. Changing a
model ID alone does not implement a new protocol or entitlement. For fal, also
review the request-path allowlist and the installed adapter's model options;
unsupported paths are intentionally rejected. Rebuild after changing the registry.
The registry is not an arbitrary remote-provider/plugin loader.

The public TanStarter page documents a model configuration location and categories,
but not a complete exported-symbol/type contract. This configuration independently
provides that centralized configuration capability; it is not a claim that private
TanStarter imports or model APIs are drop-in compatible.

## Ten editable tool modules, one guarded execution boundary

The ten documented component paths now exist under `src/components/ai/`:

| Tool | Editable card file | Server schema and execution module |
| --- | --- | --- |
| Search | `ai-web-search-card.tsx` | `src/ai/tasks/web-search.server.ts` |
| Decision | `ai-decision-card.tsx` | `src/ai/tasks/decision.server.ts` |
| Summary | `ai-summarization-card.tsx` | `src/ai/tasks/summarize.server.ts` |
| Translation | `ai-translation-card.tsx` | `src/ai/tasks/translate.server.ts` |
| Taglines | `ai-tagline-card.tsx` | `src/ai/tasks/taglines.server.ts` |
| Speech | `ai-tts-card.tsx` | `src/ai/tasks/speech.server.ts` |
| Caption | `ai-caption-card.tsx` | `src/ai/tasks/caption.server.ts` |
| Workers images | `ai-cf-image-card.tsx` | `src/ai/tasks/workers-image.server.ts` |
| fal images | `ai-image-card.tsx` | `src/ai/tasks/fal-image.server.ts` |
| Avatar editing | `ai-image-edit-card.tsx` | `src/ai/tasks/avatar.server.ts` |

Each card owns its editable field composition, localized title/presets, request
serialization and result component selection or rendering. Translation owns its
language swap/select controls; speech owns voice/audio UI; image cards own their
model or file-input choices; decision owns its typed probability presentation.
`card-fields.tsx` supplies reusable visual/input primitives, not a second tool
registry. `cards.ts` is the explicit typed registry. `card-contract.ts` documents
this starter's props and definition types. Cards never fetch or call providers.

Each server task module owns its Zod input schema and one typed service invocation
with JSON or audio output encoding. `tasks/index.server.ts` composes the schemas
and exhaustive execution dispatch. These are server-only functions, not separate
public endpoints that skip policy. The studio is a shared auth/request-state shell;
`handleApi` retains auth/CSRF and `handleAi` retains input validation, owner-scoped
idempotency, durable admission and dispatch accounting. Only after these guards
does `runAiTask` invoke the selected operation. No code path removes those guards.

For a tool-specific UX change, edit its card rather than the studio; for its input
or response contract, edit its paired task module and adapter. Keep request IDs,
submission and session-storage behavior in the shared shell. When adding a tool,
register its client card, schema/execution, navigation catalogue and capacity key,
then extend the all-tools regressions in `tests/ai-tool-modules.test.ts`.

The public page names `src/api/ai.ts`, ten card paths and two operations in prose,
`searchWeb` and `evaluateTicket`. Those paths/names are provided, but its callable
signatures, all ten export names, model-export types and component props are not
published. This implementation does not claim undocumented parameter/import
compatibility. The authenticated REST endpoint remains `/api/ai`.

## Documented-path server facades and examples

`src/api/ai.ts` is a server-only facade, not an automatically registered TanStack
Start RPC action. Its parameter contract is explicitly independent:

- `searchWeb({ query, provider? }, { request, requestId }): Promise<Response>`
- `evaluateTicket({ text, model? }, { request, requestId }): Promise<Response>`
- `dispatchAiTask(canonicalTaskPayload, { request, requestId }): Promise<Response>`

The generic dispatch name is this starter's own convenience API for all ten
validated task payloads. We do not invent the eight unpublished reference function
names. Each task also keeps its independently named server handler in `ai/tasks`.

Pass the real incoming POST Request, preserving its Origin, cookies/authorization
and cancellation signal. Supply the stable operation ID from the caller; a new ID
must not be generated to retry an uncertain result. An existing Idempotency-Key
must match. The facade rejects GET-originated mutations and mismatched IDs, replaces
only body-representation headers, and routes through the actual `handleApi` and
`handleAi`. It never fabricates an Origin or authentication, contacts a provider
directly, enables AI, or bypasses rate/usage admission. Response is returned unchanged
so JSON, audio and error metadata remain intact. A server adapter using this facade
must relay that response rather than treating every result as JSON.

`src/lib/web-search.ts` contains the client-safe provider catalogue, input
normalization and source-URL/result validators. The real server adapter shares these
validators. `src/lib/clef.ts` owns the editable rubric and result validator as server-only pure
helpers. The actual decision adapter imports that public file; the old
`src/ai/clef.server.ts` path only re-exports it. Changing question instructions
there changes the actual request. Changing question types or answer categories
also requires updating result validation and UI, not just editing prompt text.
Neither helper module exposes a paid network operation.

The editable cards include all publicly named example categories, with original
English and Chinese prompts:

- Search: travel planning, English learning and dinner ideas.
- Caption: short caption, detailed description and keyword extraction.
- Avatar: Bobblehead, Pixar 3D and Anime portrait.

Earlier independent presets remain available. Selecting a preset only populates
text; it never sends a provider request. Actual output quality/style remains a
live-provider acceptance question, not something these examples guarantee.

## HTTP errors and request references

`handleAi` keeps any dispatched failure `UNKNOWN_OUTCOME` / `outcome: unknown` /
`retryable: false`. A provider HTTP 402 is returned as HTTP 402 rather than hidden
behind 502, with `providerCode: PAYMENT_REQUIRED` and one task-derived hint:

- `CHECK_AI_GATEWAY_FUNDING`: check configured gateway credits or the selected
  search provider's stored key and provider billing.
- `CHECK_WORKERS_AI_BILLING`: check Workers AI account billing/capacity.
- `CHECK_FAL_BILLING`: check fal account credits/billing.

These are application-owned enums, not provider error codes or raw messages.
Provider response bodies are canceled and never forwarded. A 402 is a diagnostic,
not proof that nothing happened or no charge exists. The durable reservation and
capacity units remain consumed; duplicate submission with the same request ID
never starts another provider call. No automated billing changes, balance loads,
or retries occur. The operator must reconcile before a new intentional request.

Pre-dispatch configuration failures can include `CHECK_AI_CONFIGURATION`; their
outcome remains `released`, and undispatched weighted capacity is released.
No actual account ID, token, secret value, prompt, or provider body is included.

`src/lib/api-client.ts` exports `ApiError`, `apiError(response, fallbackRequestId?)`,
and `errorMessage(error)`. These keep the HTTP status and explicitly allowlisted
code/outcome/hint fields plus a bounded opaque request reference. They never keep
or display arbitrary JSON error messages, debug HTML, or the response body.
Unknown error shapes use a localized generic status explanation. This intentionally
trades unstructured server prose for safe, stable application-owned diagnostics;
add a reviewed code and localized message when more specific UX is needed.

The studio uses the same formatter for JSON/audio failures and status checks,
including a saved reference for interrupted responses. English and Chinese copy
explains funding/configuration and keeps the reference selectable/copyable in
plain text. Only the opaque reference and outcome are retained in session storage.
Funding hints are not durably persisted: a reload/status check retains conservative
outcome and reconciliation evidence, not the original 402 hint.

## Evidence and boundaries

Public documentation checked read-only on 2026-10-24:

- [TanStarter AI configuration and web-search 402 behavior](https://docs.tanstarter.dev/ai/)
- [Cloudflare Web Search setup, credits and provider keys](https://developers.cloudflare.com/web-search/how-to-use/)

The existing model IDs/defaults, operation protocols, and relative weights are
unchanged by centralization. Offline tests exercise the real handler with local
D1 and injected transports, including 402, retained budgets, no duplicate dispatch,
owner-isolated status, safe client formatting, and registry consistency. These do
not prove live provider availability, funding status, generated quality, browser
hydration/focus/clipboard behavior, or deployment correctness. No credentials,
provider inference, external mutations, browser operations, or deployments were used.

Customization regression: `tests/ai-public-customization.test.ts` overrides only
the documented public files and exercises the real service adapter. It verifies
edited search defaults, provider model IDs, capacity weights and Clef instructions
reach actual request/admission configuration. Legacy imports share object identity;
they cannot silently retain stale copied defaults.
