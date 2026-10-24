import { foldPaymentEvents, hasPaymentAccess } from '../../src/payment/entitlements';
import type { CheckoutRecord, PaymentEvent, PaymentPlan } from '../../src/payment/types';
import { isStagingName, requireSandbox, SandboxError, type SandboxConfig, type SandboxProvider } from './config';

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function assertRuntime(value: unknown, config: SandboxConfig): void {
  const runtime = record(value);
  requireSandbox(runtime.provider === config.provider && runtime.mode === 'test', 'SANDBOX_DEPLOYED_MODE_MISMATCH');
  // Waffo uses environment-bound key pairs, not prefixed credentials. The explicit
  // operator attestation plus the provider's test banner is required for this case.
  requireSandbox(runtime.credentialMode === 'test' || (config.provider === 'waffo' && runtime.credentialMode === 'unknown' && config.waffoKeyEnvironment === 'test'), 'SANDBOX_CREDENTIAL_MODE_UNVERIFIED');
}
export function assertPlan(value: unknown, config: SandboxConfig): void {
  const plan = record(value);
  requireSandbox(plan.id === config.planId && plan.available === true && plan.disabled !== true, 'SANDBOX_PLAN_UNAVAILABLE');
  requireSandbox(Number.isSafeInteger(plan.amount) && Number(plan.amount) > 0 && Number(plan.amount) <= config.maxAmountMinor && String(plan.currency).toUpperCase() === config.currency, 'SANDBOX_PLAN_EXCEEDS_BUDGET');
  if (config.scenario === 'zero-cost') requireSandbox(plan.allowPromotionCodes === true, 'SANDBOX_ZERO_COST_REQUIRES_PROMOTION_CODES');
  requireSandbox(!plan.trialPeriodDays, 'SANDBOX_PAID_SCENARIO_REQUIRES_NO_TRIAL');
}
export function assertHostedCheckout(value: unknown, provider: SandboxProvider): string {
  requireSandbox(typeof value === 'string', 'SANDBOX_INVALID_HOSTED_CHECKOUT');
  let url: URL;
  try { url = new URL(value); } catch { throw new SandboxError('SANDBOX_INVALID_HOSTED_CHECKOUT'); }
  const hosts: Record<SandboxProvider, readonly string[]> = {
    stripe: ['checkout.stripe.com'], creem: ['checkout.creem.io', 'www.creem.io', 'creem.io'],
    waffo: ['checkout.waffo.ai', 'pancake.waffo.ai'],
  };
  requireSandbox(url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts[provider].includes(url.hostname), 'SANDBOX_UNTRUSTED_CHECKOUT_HOST');
  // Stripe encodes mode in its session identifier. Do not open a live session.
  if (provider === 'stripe') requireSandbox(url.pathname.includes('cs_test_'), 'SANDBOX_STRIPE_LIVE_SESSION_BLOCKED');
  return value;
}
export function isExpectedCallback(value: string, config: SandboxConfig, reference: string, sessionId: string): boolean {
  try {
    const url = new URL(value);
    if (url.origin !== config.origin || !/^\/(?:en\/|zh\/)?settings\/payment\/?$/.test(url.pathname)) return false;
    const key = config.provider === 'stripe' ? 'session_id' : config.provider === 'creem' ? 'request_id' : 'checkout_id';
    return url.searchParams.get(key) === (config.provider === 'stripe' ? sessionId : reference);
  } catch { return false; }
}
export class RequestBudget {
  private consumed = 0;
  private checkoutCreated = false;
  constructor(private readonly maximum: number) {}
  take(kind: 'read' | 'login' | 'checkout' = 'read'): void {
    requireSandbox(this.consumed < this.maximum, 'SANDBOX_REQUEST_BUDGET_EXHAUSTED');
    if (kind === 'checkout') {
      requireSandbox(!this.checkoutCreated, 'SANDBOX_CHECKOUT_RETRY_FORBIDDEN');
      // Consume before network access: an uncertain outcome must never be retried.
      this.checkoutCreated = true;
    }
    this.consumed++;
  }
  get count(): number { return this.consumed; }
}
export const queries = {
  fixture: 'SELECT id, email FROM user WHERE id = ? LIMIT 2',
  checkouts: 'SELECT reference, user_id, provider, plan, created_at, session_id FROM payment_checkouts WHERE user_id = ? ORDER BY created_at DESC LIMIT 2',
  events: 'SELECT event_id, payload FROM payment_events WHERE provider = ? AND checkout_reference = ? ORDER BY occurred_at ASC, id ASC LIMIT 101',
} as const;
/** Only named, fixed SELECT statements are exposed. Values are always bound. */
export class D1Verifier {
  constructor(private readonly config: SandboxConfig, private readonly budget: RequestBudget, private readonly transport: typeof fetch = fetch) {}
  private async call(path: string, body?: unknown): Promise<unknown> {
    this.budget.take();
    try {
      const response = await this.transport(`https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/d1/database/${this.config.databaseId}${path}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${this.config.cloudflareToken}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      requireSandbox(response.ok, 'SANDBOX_D1_HTTP_FAILED');
      const envelope = record(await response.json());
      requireSandbox(envelope.success === true, 'SANDBOX_D1_API_FAILED');
      return envelope.result;
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      throw new SandboxError('SANDBOX_D1_REQUEST_FAILED');
    }
  }
  async verifyDatabase(): Promise<void> {
    const database = record(await this.call(''));
    requireSandbox(database.uuid === this.config.databaseId && typeof database.name === 'string' && isStagingName(database.name), 'SANDBOX_D1_STAGING_MISMATCH');
  }
  async select(name: keyof typeof queries, params: string[]): Promise<Record<string, unknown>[]> {
    const result = await this.call('/query', { sql: queries[name], params });
    requireSandbox(Array.isArray(result) && result.length === 1, 'SANDBOX_D1_INVALID_RESPONSE');
    const query = record(result[0]);
    requireSandbox(query.success === true && Array.isArray(query.results), 'SANDBOX_D1_QUERY_FAILED');
    requireSandbox(record(query.meta).changed_db !== true && Number(record(query.meta).rows_written ?? 0) === 0, 'SANDBOX_D1_UNEXPECTED_WRITE');
    return query.results.map(record);
  }
}
export function parseCheckout(rows: Record<string, unknown>[], config: SandboxConfig, reference: string, sessionId: string, since: number): CheckoutRecord {
  requireSandbox(rows.length === 1, 'SANDBOX_CHECKOUT_COUNT_MISMATCH');
  const row = rows[0];
  requireSandbox(row.reference === reference && row.user_id === config.userId && row.provider === config.provider && row.session_id === sessionId, 'SANDBOX_CHECKOUT_OWNERSHIP_MISMATCH');
  requireSandbox(typeof row.created_at === 'number' && row.created_at >= since - 5_000, 'SANDBOX_CHECKOUT_NOT_CURRENT');
  let plan: Record<string, unknown>;
  try { plan = record(JSON.parse(String(row.plan))); } catch { throw new SandboxError('SANDBOX_D1_INVALID_PLAN'); }
  requireSandbox(plan.id === config.planId && typeof plan.priceId === 'string' && ['subscription', 'one_time'].includes(String(plan.kind)), 'SANDBOX_D1_PLAN_MISMATCH');
  requireSandbox(Number.isSafeInteger(plan.amount) && Number(plan.amount) > 0 && Number(plan.amount) <= config.maxAmountMinor && String(plan.currency).toUpperCase() === config.currency, 'SANDBOX_D1_PLAN_BUDGET_MISMATCH');
  requireSandbox(plan.kind === (config.planId === 'lifetime' ? 'one_time' : 'subscription'), 'SANDBOX_D1_PLAN_KIND_MISMATCH');
  return { reference, userId: config.userId, provider: config.provider, sessionId, createdAt: row.created_at, plan: plan as unknown as PaymentPlan };
}
export function parseEvents(rows: Record<string, unknown>[], checkout: CheckoutRecord): PaymentEvent[] {
  requireSandbox(rows.length <= 100, 'SANDBOX_EVENT_BUDGET_EXHAUSTED');
  const seen = new Set<string>();
  return rows.map(row => {
    let event: Record<string, unknown>;
    try { event = record(JSON.parse(String(row.payload))); } catch { throw new SandboxError('SANDBOX_D1_INVALID_EVENT'); }
    requireSandbox(typeof event.id === 'string' && row.event_id === event.id && !seen.has(event.id), 'SANDBOX_DUPLICATE_EVENT_ID');
    seen.add(event.id);
    requireSandbox(event.provider === checkout.provider && event.checkoutReference === checkout.reference, 'SANDBOX_EVENT_CORRELATION_MISMATCH');
    requireSandbox(typeof event.occurredAt === 'number' && event.occurredAt >= checkout.createdAt - 5_000 && event.occurredAt <= Date.now() + 60_000, 'SANDBOX_EVENT_NOT_CURRENT');
    requireSandbox(['sync', 'grant', 'revoke', 'receipt', 'ignore'].includes(String(event.effect)) && event.lookup && typeof event.lookup === 'object', 'SANDBOX_EVENT_INVALID');
    return event as unknown as PaymentEvent;
  });
}
export function assertPaidEvidence(checkout: CheckoutRecord, events: PaymentEvent[], apiStatus: unknown, billing: unknown, now = Date.now()): void {
  const authority = checkout.provider === 'stripe' ? ['invoice.paid'] : checkout.provider === 'creem' ? [checkout.plan.kind === 'one_time' ? 'checkout.completed' : 'subscription.paid'] : [checkout.plan.kind === 'one_time' ? 'order.completed' : 'subscription.activated'];
  requireSandbox(events.some(event => event.effect === 'grant' && authority.includes(event.type)), 'SANDBOX_AUTHORITATIVE_WEBHOOK_MISSING');
  const projection = foldPaymentEvents(checkout, events);
  requireSandbox(projection.paid && projection.state === 'active' && hasPaymentAccess(projection, now), 'SANDBOX_D1_ENTITLEMENT_NOT_ACTIVE');
  const status = record(apiStatus);
  requireSandbox(status.reference === checkout.reference && status.planId === projection.plan.id && status.state === projection.state && status.paid === true && status.hasAccess === true && status.periodEnd === projection.periodEnd, 'SANDBOX_CURRENT_ORDER_STATUS_MISMATCH');
  const result = record(billing);
  const orders = Array.isArray(result.checkouts) ? result.checkouts.map(record) : [];
  requireSandbox(orders.length === 1 && orders[0].reference === checkout.reference && orders[0].hasAccess === true, 'SANDBOX_BILLING_ORDER_MISMATCH');
  const entitlement = record(result.entitlement);
  requireSandbox(entitlement.reference === checkout.reference && entitlement.userId === checkout.userId && entitlement.provider === checkout.provider && record(entitlement.plan).id === projection.plan.id && entitlement.state === 'active' && entitlement.paid === true && entitlement.periodEnd === projection.periodEnd, 'SANDBOX_CURRENT_ENTITLEMENT_MISMATCH');
}
