# Payments: independent, server-only implementation

Hosted checkout adapters for Stripe, Creem and Waffo. No proprietary template code. Never import provider factories into browser bundles or log hosted URLs, credentials, raw webhook bodies, customer details or recovery requests. Waffo URLs can contain bearer tokens.

## Current guarantees and deliberate limits

- Access comes only from paid-authority ledger facts or explicit trials. Checkout creation, successful redirects and ordinary active subscription updates never prove a new payment.
- One subscription item per checkout is supported. Stripe invoice normalization takes plan and interval from the same authoritative non-credit line. Multi-item, mixed-price or truncated invoices return retryable errors instead of guessing. Zero-amount discounted recurring lines remain valid. Legacy and modern line schemas have fixtures, not live-account certification.
- A late payment of an old interval cannot replace a newer paid service interval. A legitimate shorter current interval, such as annual to monthly, can supersede the old interval. An authoritative subscription read can select a matching existing paid grant, but cannot invent or extend paid coverage.
- Opaque provider IDs only deduplicate; they never break timestamp ties. Unresolved subscription identity, state, plan or cancellation-intent conflicts set `reconciliationRequired`, hold access, and remain visible. A verified current subscription read can reconcile matching paid facts. This may temporarily hold otherwise-paid coverage after ambiguous same-second cancellation events; it is an intentional fail-closed tradeoff.
- Canceled, fully reversed or disputed purchases remain terminal. A later paid event or status read cannot revive them. Refund policy remains provider-specific: Stripe full lifetime refunds revoke only that purchase; Creem refund/dispute handling remains opt-in; Waffo successful refunds retain its existing conservative revocation policy.
- Stable customer mappings are per user/provider inside an immutable deployment/payment namespace. Stripe creates a customer with a stable idempotency key then persists the ID; later checkout passes `customer`, not a fresh email-only customer. Creem reuses known customer IDs. Historical portals accept an owned checkout reference, not a browser-supplied customer ID, so old duplicate customers remain manageable.
- A second unresolved recurring checkout is atomically rejected across providers. Use the existing subscription’s provider portal to change plans. One-time purchases do not hide old recurring subscriptions or their historical portal links.

## Lifecycle and supported recovery

Checkout lifecycle is `creating`, `open`, `failed`, `expired`, `completed` or `unknown`, separately from entitlement state. The immutable original request is server-only recovery data and is never included in public status/history DTOs.

Only a positively identified pre-creation rejection becomes `failed`. A timeout, ambiguous response, rate limit or unknown result stays `unknown`. A verified expired checkout with no subscription can be terminal without pretending it was a canceled subscription. `failed`/`expired` are deletion-safe only when no subscription, payment or reconciliation ambiguity exists. Scheduled cancellation, refunds and disputes alone are not proof that recurring billing ended.

`POST /api/payments` with `{action:"reconcile", provider, reference, sessionId?}` retrieves authoritative state. Authentication, ownership and same-origin requirements still apply. The optional provider session ID is only a lookup candidate: the adapter verifies mode and exact original reference before adopting it. Never send a status such as “failed” from the browser.

- Stripe retrieves a known Checkout Session. When its ID was lost, the exact saved request/key can be replayed only within 23 hours, inside Stripe’s documented minimum 24-hour idempotency retention. After that, it stays unknown until the original session ID is obtained from provider support and verified by retrieval. No fresh checkout is invented as a repair.
- Creem retrieves known Checkout Sessions and maps documented pending/processing/completed/expired statuses. It does not replay creation because durable request-ID retention is not established by the verified contract. If the ID was lost, obtain the original ID through provider support, then use the verified rebind flow.
- Waffo has no verified checkout-status retrieval contract in this adapter. Ask provider support to investigate the exact merchant external reference and redeliver applicable terminal/cancellation events. The application deliberately keeps unresolved Waffo checkouts blocked. There is no arbitrary admin “mark failed” or age-based unlock. This remains a provider-specific limitation, not a claimed fully repaired self-service flow.

Both Stripe and Creem can retrieve the current known subscription to resolve snapshot ambiguity. Reads never grant an unpaid purchase. An ended subscription observation is recorded as a terminal cancellation fact, not a button-click assumption.

## Configuration, provider switches and isolation

- `VITE_PAYMENT_PROVIDER` chooses new purchases. `PAYMENT_NEW_CHECKOUTS_ENABLED=false` pauses new checkout without discarding existing callbacks.
- `PAYMENT_LEGACY_PROVIDERS=stripe,creem` explicitly enables historical management and callbacks after switching the new-purchase provider. Keep each legacy provider’s valid credentials, webhook endpoint and historical plan configuration. Unsupported/unconfigured webhook routes return 404, never a misleading successful acknowledgement.
- `STRIPE_HISTORICAL_PLANS`, `CREEM_HISTORICAL_PLANS`, `WAFFO_HISTORICAL_PLANS` hold retired mappings for their own provider. Existing `PAYMENT_HISTORICAL_PLANS` remains a fallback only for the current provider. Unknown prices return retryable errors; do not remove mappings before old invoices can be reconciled.
- `STRIPE_API_VERSION` can pin the API snapshot schema to the version used by the registered endpoint. Test both API and webhook versions during provider acceptance.
- New return URLs carry provider identity. Older reference/session-only links are resolved across registered providers only when an owned checkout is unambiguous. Pure history does not depend on the current provider matching every old row.
- Test and live still require separate Worker/D1 resources. An immutable global mode/deployment row plus per-provider credential identity fingerprint prevents request-time mode/account reuse. `PAYMENT_NAMESPACE` defaults to the exact `APP_URL` origin. Initial claims happen only on empty databases; existing unadopted ledgers fail closed.
- Credential rotation deliberately changes the fingerprint and fails readiness until a separately reviewed namespace rebind/migration. This is a conservative safety gate, not automatic proof that credentials belong to the same merchant. Do not change mode/account labels to make readiness green.

## Durable storage and bounded reads

D1 commits the unique event insert, revision-checked checkout projection and indexed provider references in one transactional batch. Concurrent conflicts retry a bounded number of times; duplicates do not overwrite the first fact. Projection reads are authoritative because they cannot commit separately from the ledger event. Per-checkout projections can be rebuilt from the append-only ledger.

History uses `(created_at,reference)` keyset pagination, maximum 50 rows. History plus entitlement requires three store statements, independent of the requested page or 0/17/100/1000 pending history rows in local D1 regressions. Entitlement is not selected from the visible page. Exact reference lookups use primary-key/index branches and an indexed historical-reference table, not provider-wide JSON scans. A missing legacy projection is a migration error, never silently “no access”.

This bounds response size and request statement counts; it does not claim constant database work for every possible ledger size. Appending/rebuilding one checkout still replays that checkout’s history. Very long-lived/high-frequency ledgers may require a further compacted projection design before scale warrants it.

## Local upgrade and operational recovery

Apply current local migrations first, back up the exact database, and stop the local Worker. `npm run payment:recover -- ...` is local-only, dry-run by default, never calls payment providers, never runs migrations and never changes payment/lifecycle facts. It never contacts remote D1.

1. `--action namespace-plan --provider stripe` computes the identity tuple from explicitly supplied process environment. It prints only mode, deployment and SHA-256 identity fingerprint, never a key. Do not paste credentials into arguments or chat.
2. `--action adopt-namespace --file PATH --provider stripe --mode test --deployment EXACT_NAMESPACE --account-fingerprint SHA256` shows the exact local target/tuple without opening the DB. Review existing ledger provenance against the actual provider/account/mode. Do not adopt old test records as live.
3. Only after that review, repeat with `--execute --worker-stopped --verified-existing-ledger --confirm-target EXACT_DISPLAYED_PATH --confirm-namespace 'DEPLOYMENT|MODE|PROVIDER|FINGERPRINT'`. Adoption inserts missing namespace rows; it refuses to overwrite existing conflicting identities. Credential rotation is not handled by this shortcut.
4. `--action rebuild --file PATH` shows the backfill plan. Repeat with `--execute --worker-stopped --confirm-target EXACT_DISPLAYED_PATH`. Each invocation rebuilds at most two missing projections and their historical reference indexes. Repeat while `remaining=true`. `--provider ... --reference ...` selects one exact checkout for a reviewed rebuild.
5. `--action inspect --file PATH --execute --confirm-target EXACT_DISPLAYED_PATH` prints lifecycle/failure aggregate counts, not raw payment/customer data. `--action reconcile-help --provider ... --reference ...` gives the provider-specific supported recovery route without opening a DB.

Remote upgrades and same-account credential rotation require a separately authorized, reviewed operational workflow. Do not run local recovery against copied production data and overwrite a live database. The tool does not attest legal retention policy or recover deleted financial history.

## Webhooks, diagnostics and testing

Raw body/signature/mode/store checks remain intact, with a streamed 1 MiB cap. Success is returned only after durable handling. Signature failures return 400; processing/configuration failures remain retryable. Turning off new checkout does not acknowledge-and-drop existing events.

Safe structured diagnostics include provider, verified event ID, known error code and request ID. A durable failure index records verified normalization/correlation/persistence failures and clears after successful redelivery. It stores no raw payload or URLs. If D1 is unavailable, safe logs remain the fallback. Operators correct configuration or recover the missing context then request provider redelivery; Stripe/Creem retries are finite, not an infinite recovery system.

Notifications occur after financial commit and remain best-effort. Rejected notification outcomes are logged safely; notification failure does not roll back or re-grant payment. Guaranteed notification delivery would need a separate outbox. Configured plan prices are not actual tax/discount receipt totals.

Run focused synthetic/local tests:

`npx vitest run tests/payment.test.ts tests/payment-provider-review.test.ts tests/payment-lifecycle-review.test.ts tests/payment-store.integration.test.ts tests/payment-recovery.test.ts`

No fixture proves live-provider correctness. No real payment, merchant/customer operation, provider reconciliation request, credential access, remote migration, deployment or browser security reproduction was performed for this remediation. Provider sandbox end-to-end acceptance remains required.

Official sources verified 2026-10-24:
- https://docs.stripe.com/billing/subscriptions/prorations
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/error-low-level
- https://docs.stripe.com/api/checkout/sessions/retrieve
- https://docs.stripe.com/api/subscriptions/retrieve
- https://docs.stripe.com/webhooks
- https://docs.creem.io/api-reference/endpoint/get-checkout
- https://docs.creem.io/api-reference/endpoint/get-subscription
- https://docs.creem.io/skills/creem-api/REFERENCE
- https://docs.waffo.ai/api-reference/webhooks

## Public compatibility surface and adding a provider

`providerRegistry` is exported from `src/payment/index.ts` and defined in the server-only `registry.ts`. Add a trusted factory registration there, set `VITE_PAYMENT_PROVIDER` to its lower-case slug, and configure public prices. The API, legacy management, webhook routing and namespace identity all use that registry; no extra router/type whitelist is needed. Never register browser-supplied factories, endpoints or keys. Credentials stay in Worker bindings.

Each registration supplies `create({env, mode})`, `credentialIdentity(env)` and `webhookSignatureHeader`; capability declarations describe checkout/subscription recovery. The returned adapter must use the registered identity and implement the server-only `PaymentAdapter` from `types.ts`. A provider must verify raw signatures, expected mode and merchant/store ownership before returning normalized facts. Missing recovery APIs must remain unsupported, not implemented by guessing final states or replaying unbounded creates. Namespace identity remains hashed and immutable, including for custom providers.

`createPaymentProviderFacade(serviceConfig)` exposes `getProviderName`, `createCheckout`, `createCustomerPortal` and `handleWebhookEvent(payload, signature)`, plus the public `CreateCheckoutParams`, `CheckoutResult`, `CreatePortalParams`, `PortalResult` and `PaymentProvider` types (`PaymentProviderFacade` is a compatibility alias). These call the existing authenticated ledger service. `requiresCustomerId` defaults to true and is enforced before opening a portal; shared portals explicitly opt out. `hostsPostCheckoutPage` defaults to false; opting in puts the server-generated reference in the return URL while each adapter keeps its provider-specific alias. All three built-in registrations declare their actual behavior.

The public `PaymentProvider` interface accepts a custom class with those four method names and optional flags; it does not require the internal `id`, `verifyWebhook` or `createPortal` members. A custom class may delegate to `createPaymentProviderFacade` for the existing engine, rather than reimplementing persistence. The compile-and-execution fixture in `tests/payment-parity-remediation.test.ts` exercises that class through the registered adapter, verifies the signature header reaches the verifier unchanged, asserts namespace validation and ledger insertion, and calls checkout and portal methods.

The registry is an intentional extended integration contract, not the upstream factory shape verbatim: its `create` returns `PaymentAdapter`, with credential identity and raw signature header metadata. Merely returning an arbitrary public class whose `handleWebhookEvent` yields `void` cannot establish signature validation, normalized paid authority or durable persistence, so the application does not treat it as sufficient ledger admission. Runtime checkout/webhook construction actually uses this registry in `src/api/payments.server.ts`; it is not a disconnected list of examples.

This facade follows the documented method names and flags, but is not a promise that unexposed proprietary TanStarter parameter types/classes can be pasted in unchanged. In SaaSStarterKit, normalized webhook facts, explicit cancellation/recovery support and immutable namespace identity are required adapter contracts. The facade does not accept user IDs from unauthenticated HTTP input: protected route authentication and same-origin mutation checks still wrap it.

### Plan configuration and historical identity

`websiteConfig.payment.price.plans` references the canonical `groupedPlans` in `src/config/plans.ts`. `publicPlans` is a derived view, not a second catalogue. Group/price disabled flags hide new checkout but leave historical definitions available. `popular`, `limits`, `isFree`, `isLifetime` and singular `allowPromotionCode` are explicit configuration; legacy UI/runtime names are derived. Stable `catalogId` values identify historical purchases and must not be renamed after billing begins. Example prices intentionally remain SaaSStarterKit's own, not a claim about actual provider charges.

For the active provider, an explicit grouped `priceId` is authoritative; otherwise the existing runtime `${PROVIDER}_${CATALOG_ID}_PRICE_ID` and public provider-map fallbacks apply. Historical providers never borrow today's grouped price ID. Keep retired mappings configured per provider. A newly added group must exist at application initialization so its flattened checkout/presentation views are built; mutable runtime catalogue editing is not supported.

Explicit `VITE_BASE_URL` (or its older `VITE_APP_URL` alias) is the payment return origin. If server `APP_URL` is also present, its origin must match; conflicting origins fail closed. Server-only `APP_URL` remains compatible when no public URL was built in. Do not substitute a webhook tunnel hostname for the application's canonical origin.

### Applied Waffo changes and recovery UX

Waffo subscription grants now retain `currentPeriodStart` and `currentPeriodEnd`. An applied `subscription.plan_changed` needs valid bounds and a configured new product; incomplete bounds retry. A newer paid interval can shorten an old annual period. When date-only bounds share a start day, an explicit applied change to a distinct newer order selects that order, rather than retaining the longest old window. Contradictory same-time identities remain held for reconciliation. Scheduled and failed changes remain non-granting. Terminal, refund and dispute rules are unchanged.

After authoritative confirmation, the payment page invalidates the owner's billing caches and automatically replaces its URL with localized billing, while retaining a status announcement and manual link. Leaving/changing the page cancels its redirect. No redirect or checkout lifecycle creates access.

A successful Stripe/Creem refresh can now return `checkoutUrl` only for a freshly queried, owned, still-open, unpaid and unambiguous checkout without a subscription. Billing then offers Continue payment. The URL is ephemeral browser state, never persisted into ledger/history or logged; terminal/paid/unknown results do not offer it. Waffo still has no verified retrieval implementation here.

### Waffo merchant readiness checklist (operator action, not performed by the template)

- Complete the applicable merchant identity/KYB and store reviews, and verify the account is allowed to accept real payments.
- Create separate test/production API keys and products; publish intended production products and check configured product IDs/metadata.
- Keep `PAYMENT_MODE`, `WAFFO_MERCHANT_ID`, `WAFFO_STORE_ID`, the correct private key and the corresponding isolated Worker/D1 consistent. A PEM format alone cannot establish mode or ownership.
- Use a direct HTTPS webhook or a tunnel that preserves the raw body and `X-Waffo-Signature`. Do not use localtunnel for webhooks: the reference integration warns that it strips custom signature headers. Use a verified header-preserving option and test it in isolated sandbox staging.
- Validate immediate and next-period plan changes separately, including a new order, shorter period, both delivery orders, refund and portal email delivery. These offline fixtures do not certify account readiness or live integration.

Contract sources rechecked 2026-10-24: [shared payment](https://docs.tanstarter.dev/payment/), [website plans](https://docs.tanstarter.dev/config/website/), [Waffo setup](https://docs.tanstarter.dev/payment/waffo/), [Waffo applied/scheduled events](https://docs.waffo.ai/api-reference/webhooks), and [Waffo plan-change rules](https://docs.waffo.ai/features/subscriptions).

### Minimal typed adapter bridge

A vendor-specific integration must first implement `PaymentAdapter`: its `verifyWebhook` validates the raw body/signature, mode and merchant/store, then returns a `PaymentEvent`; its checkout method uses the supplied server reference, not a client-provided identity. No generic bridge can infer those facts from a public `handleWebhookEvent(): Promise<void>` result. The following registration helper is complete and vendor-agnostic; the caller supplies that verified adapter factory rather than placeholder network code:

```ts
import { providerRegistry, type ProviderRegistration } from "./registry";

export function registerMyProvider(
  createVerifiedAdapter: ProviderRegistration["create"],
) {
  providerRegistry["my-provider"] = {
    create: createVerifiedAdapter,
    credentialIdentity: (env) => env.MY_PROVIDER_KEY,
    webhookSignatureHeader: "my-provider-signature",
    requiresCustomerId: true,
    hostsPostCheckoutPage: true,
  };
}
```

Call this only from trusted server initialization (or add the equivalent entry directly to `registry.ts`), before any payment runtime is constructed. The supplied factory returns an adapter with `id: "my-provider"`. Set `VITE_PAYMENT_PROVIDER=my-provider`, supply that server-only key, and configure prices in the canonical group. Its public class can delegate the documented methods to `createPaymentProviderFacade({provider: registeredAdapter, store, plans, appOrigin, namespace})`; preserve the same namespace/store configuration used by the application. Do not register a public class returning `void` as a raw webhook verifier or implement a second payment table.

`tests/payment-extension-contract.typecheck.ts` deliberately requires compiler errors for assigning a public provider to `PaymentAdapter` or its factory. `tests/payment-public-extension.integration.test.ts` registers a custom adapter and executes the application's real checkout, webhook, billing and portal handlers against isolated local D1, including pending-before-authority, duplicate-event persistence and namespace checks. The signature verifier is a fixture seam, not a real vendor certification. Public-class-only registration remains an explicit extension-contract difference, not full upstream plug-in parity.

Ordinary grouped prices with no `catalogId` derive stable IDs from the group and monthly/yearly interval through the same helper used by server lookup. Multiple same-group/same-interval prices must have distinct explicit IDs or configuration fails, including when one is disabled. Keep the old historical ID unchanged; give the replacement a new ID such as `pro-monthly-v2`. Never silently rename the old price to a new retired ID after it has been used.
