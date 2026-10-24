# Bounded AI execution policy

D-07 is a **conditional production cost/capacity gate**, not a claim that the public reference template promised subscription credits, team billing, or a universal financial ledger. The implementation remains an independently designed starter policy.

## Safe default and enablement

`websiteConfig.ai.enabled` ships as `false`. Sign-up, payment access and adding provider credentials do not enable AI execution. Disabled POST calls return `503 / AI_DISABLED` without dispatching a provider call. An owner who deliberately enables AI must keep all per-user/global daily request, weighted-unit and concurrent-lease limits finite and valid. `aiPolicyIssue()` supports credential-free readiness checks. Provider keys remain server-only.

Default limits are 20 requests / 40 weighted units per user per UTC day, 200 requests / 400 units across the deployment per UTC day, one user lease and four global leases, a 180-second lease, and 30 days of terminal-idempotency retention. Absolute validation bounds cap requests at 10,000/day and concurrent leases at 100. The model weights in the authoritative `src/config/ai-models.ts` (also re-exported by `models.ts` and `policy.ts`) are conservative **relative capacity units, not currency prices or a guarantee of a maximum invoice**. Costs still depend on model prices, input/output sizes and provider behavior. This does not add plan-based entitlement or purchased-credit accounting.

Use one D1 primary for all instances sharing these limits. Each admission is one `INSERT ... SELECT` statement that evaluates daily user/global request counts, weighted-unit budgets and current leases before inserting the reservation. It is not a read-then-write counter. All admitted attempts consume a daily request count, even if pre-dispatch validation/configuration later fails, bounding daily durable-row growth. Undispatched/released attempts release model units and leases, but unknown paid outcomes do not. Raw API validation rejected before admission creates no reservation.

## Request and outcome contract

- POST `/api/ai` requires a client-generated stable `Idempotency-Key` of 16–128 letters, digits, hyphens or underscores. A UUID is suitable. Keep that ID for that exact operation. Reusing it with different input returns `AI_REQUEST_CONFLICT` without dispatch.
- Duplicate pending, succeeded, released or unknown IDs do not create a provider call. There is no automatic paid retry, including inside the fal SDK transport. A deliberately new operation requires a new ID.
- Successful responses preserve existing JSON/audio formats and add `X-AI-Request-Id` and `X-AI-Outcome: succeeded`. Outputs are **not** durably cached; a completed duplicate returns `AI_ALREADY_COMPLETED`, not fabricated output.
- A dispatched HTTP 402 preserves HTTP 402 and application-owned `providerCode`/`setupHint` diagnostics for billing or gateway configuration. It remains `UNKNOWN_OUTCOME`, consumes the original weighted budget, and never automatically retries. See [model configuration and diagnostics](MODEL_CONFIGURATION.md).
- Safe error envelopes contain `error`, `code`, `requestId` when available, `outcome` and `retryable: false`. `UNKNOWN_OUTCOME` is visible to callers and means that a provider charge or result may exist. Do not resubmit it blindly.
- Authenticated GET `/api/ai?requestId=...` is an owner-scoped, read-only lookup. It does not poll providers or replay jobs and remains available with AI disabled. A missing record is not authority to resubmit an old unknown request, particularly beyond retention.
- The studio persists only the opaque request ID/outcome in per-user browser session storage before sending, holds it across navigation/interruption, provides explicit read-only status checks, and asks before starting another operation while the earlier outcome is uncertain. Stopping browser waiting is not provider cancellation.

An atomic `reserved -> running` transition happens before the initial provider POST. It requires an unexpired reservation and renews that existing concurrency slot for a full lease. A pre-dispatch failure may become `released`; after any dispatch, errors including HTTP failures or malformed output conservatively become `unknown`. If outcome persistence fails, the original durable running record remains and an expired running lease reads as unknown. A returned fal queue request ID and model path are persisted **before polling**. Persistence failure stops orchestration rather than re-submitting, and the known reference is included in the immediate safe error response where possible.

## Boundaries and operations

- Leases bound active local executions, not the lifetime of a remote queued job. A provider can continue or internally retry after a local timeout; an expired lease is not proof of cancellation. Daily attempt/unit caps remain enforced. Set provider-side hard spending/concurrency controls as well before public paid use.
- `pruneAiUsage(db, retentionDays, limit=100)` marks at most `limit` expired reservations/runs and removes at most `limit` terminal succeeded/released rows older than the configured retention. It never deletes unknown outcomes automatically. Invoke through the scheduled maintenance path; examine unresolved-job age and growth operationally. Idempotency for terminal rows is guaranteed only inside the configured retention window. Unknown references remain until an explicitly designed reconciliation/retention decision.
- `ai_usage_requests` stores hashed user IDs, payload digests, model category/units, outcomes, timestamps and optional provider job references. It stores no prompts, image inputs, model outputs, credentials or monetary balances. It is operational budget metadata, **not a financial ledger**. No user foreign key is used: account deletion must not reset global daily costs or erase unresolved references. Product privacy/retention notices must reflect this minimal retained metadata.
- Automatic provider reconciliation/resumption, result retention, operator resolution tooling, monthly monetary budgets, billing-credit conversion and per-plan access are intentionally not invented here. Use the recorded fal reference with the provider's authoritative read APIs or dashboard for an authorized reconciliation; never mark uncertain work free based solely on age.
- R2 total storage quotas are a separate capacity gate. These AI controls do not claim to bound storage cost, erase cross-system R2/D1 consistency limits, or certify a public paid launch.

## Verification

`tests/ai-usage.integration.test.ts` uses isolated local Miniflare/D1 storage and injected provider transports. `tests/ai-request-state.test.ts` tests client reference retention, user isolation and unavailable storage. Existing service fixtures still exercise adapter contracts. No live provider inference, credentials, remote migration, deployment, browser/security retest or spending is part of this work.

Official contracts consulted on 2026-10-24:
- [D1 primary execution and single-threaded query semantics](https://developers.cloudflare.com/d1/reference/faq/)
- [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 indexes](https://developers.cloudflare.com/d1/best-practices/use-indexes/)
- [fal asynchronous queue lifecycle and request identifiers](https://docs.fal.ai/model-apis/model-endpoints/queue)
