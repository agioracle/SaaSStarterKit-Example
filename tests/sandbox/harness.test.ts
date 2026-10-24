import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { foldPaymentEvents, hasPaymentAccess } from '../../src/payment/entitlements';
import { assertLifecycle, assertNoGrant, assertPortalUrl, assertStripeScenario, readStripeSession } from './scenarios';
import type { CheckoutRecord, PaymentEvent } from '../../src/payment/types';
import { sandboxPreflight } from '../../scripts/provider-sandbox';
import { readSandboxConfig, type SandboxConfig, type SandboxProvider, type SandboxScenario } from './config';
import { assertHostedCheckout, assertPaidEvidence, assertPlan, assertRuntime, D1Verifier, isExpectedCallback, parseCheckout, parseEvents, queries, RequestBudget } from './verification';
const runState = vi.hoisted(() => ({ step: '', advanceClock: false }));
vi.mock('@playwright/test', () => ({ test: { step: async (name: string, callback: () => Promise<void>) => { runState.step = name; return callback(); } } }));
vi.mock('node:timers/promises', () => ({ setTimeout: async (ms: number) => { if (runState.advanceClock) vi.advanceTimersByTime(ms); else throw Error('Unexpected polling in immediate mock'); } }));
import { runSandboxAcceptance } from './runner';
const accountId = 'a'.repeat(32);
const databaseId = '00000000-0000-4000-8000-000000000001';
const origin = 'https://payments-staging.example.test';
function environment(provider: SandboxProvider = 'stripe'): NodeJS.ProcessEnv {
  return {
    SANDBOX_RUN: 'I_UNDERSTAND_TEST_ONLY', SANDBOX_OPERATOR_ACK: 'TEST_CARDS_ONLY',
    SANDBOX_ENVIRONMENT: 'staging', SANDBOX_FIXTURE_ACK: 'DEDICATED_DISPOSABLE_USER',
    SANDBOX_PROVIDER: provider, SANDBOX_PLAN_ID: 'pro-monthly', SANDBOX_BASE_URL: origin,
    SANDBOX_ALLOWED_ORIGINS: origin, SANDBOX_USER_ID: 'sandbox-fixture-user',
    SANDBOX_USER_EMAIL: 'sandbox.fixture@example.invalid', SANDBOX_USER_PASSWORD: 'NotARealPassword!123',
    SANDBOX_CLOUDFLARE_ACCOUNT_ID: accountId, SANDBOX_D1_DATABASE_ID: databaseId,
    SANDBOX_ALLOWED_D1_IDS: databaseId, SANDBOX_CLOUDFLARE_API_TOKEN: 'unit-test-not-a-real-token',
    SANDBOX_MAX_AMOUNT_MINOR: '2500', SANDBOX_CURRENCY: 'USD',
    ...(provider === 'waffo' ? { SANDBOX_WAFFO_KEY_ENVIRONMENT: 'test' } : {}),
  };
}
function config(provider: SandboxProvider = 'stripe'): SandboxConfig { return readSandboxConfig(environment(provider)); }
function checkout(provider: SandboxProvider = 'stripe'): CheckoutRecord {
  return { reference: 'fresh-reference', userId: 'sandbox-fixture-user', provider, sessionId: provider === 'stripe' ? 'cs_test_fixture' : 'session-fixture', createdAt: Date.now(), plan: { id: 'pro-monthly', priceId: 'test-plan-price', kind: 'subscription', amount: 1900, currency: 'usd', interval: 'month' } };
}
function grant(order: CheckoutRecord): PaymentEvent {
  return { id: 'evt_test_fixture', provider: order.provider, type: order.provider === 'stripe' ? 'invoice.paid' : order.provider === 'creem' ? 'subscription.paid' : 'subscription.activated', occurredAt: Date.now(), effect: 'grant', state: 'active', periodStart:Date.now()-86_400_000, periodEnd: Date.now() + 86_400_000, checkoutReference: order.reference, lookup: { checkoutReference: order.reference } };
}
function evidence(order: CheckoutRecord, event: PaymentEvent) {
  const status = { reference: order.reference, planId: order.plan.id, state: 'active', paid: true, hasAccess: true, periodEnd: event.periodEnd };
  return { status, billing: { checkouts: [status], entitlement: { ...order, state: 'active', paid: true, periodEnd: event.periodEnd } } };
}
function projectionEvidence(order: CheckoutRecord, events: PaymentEvent[]) {
  const projected = foldPaymentEvents(order, events); const access = hasPaymentAccess(projected);
  const status = { reference: order.reference, planId: projected.plan.id, state: projected.state, paid: projected.paid, hasAccess: access, periodEnd: projected.periodEnd, cancelAtPeriodEnd: projected.cancelAtPeriodEnd };
  return { status, billing: { checkouts: [status], entitlement: access ? projected : null } };
}
function lifecycleFixture(scenario: SandboxScenario, order: CheckoutRecord, initial: PaymentEvent): PaymentEvent {
  const event: PaymentEvent = { ...initial, id: 'evt_test_lifecycle', occurredAt: initial.occurredAt + 1 };
  if (scenario === 'cancel-at-period-end') Object.assign(event, { effect: 'sync', cancelAtPeriodEnd: true, type: order.provider === 'stripe' ? 'customer.subscription.updated' : order.provider === 'creem' ? 'subscription.scheduled_cancel' : 'subscription.canceling' });
  if (scenario === 'full-refund') Object.assign(event, { effect: 'revoke', state: 'refunded', type: order.provider === 'stripe' ? 'charge.refunded' : 'refund.succeeded' });
  if (scenario === 'renewal') Object.assign(event, { type: 'subscription.renewed', periodStart:initial.periodEnd, periodEnd: Number(initial.periodEnd) + 86_400_000 });
  if (scenario === 'plan-change') Object.assign(event, { type: order.provider === 'stripe' ? 'invoice.paid' : order.provider === 'creem' ? 'subscription.paid' : 'subscription.plan_changed', periodStart:initial.occurredAt,periodEnd:initial.occurredAt+365*86_400_000,plan: { ...order.plan, id: 'pro-yearly', priceId:'test-plan-price-yearly', amount: 19000, interval: 'year' } });
  return event;
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('sandbox fail-closed preflight (offline)', () => {
  it('requires explicit opt in and does not imply a live run passed', () => {
    expect(() => readSandboxConfig({})).toThrow('SANDBOX_OPT_IN_REQUIRED');
    expect(sandboxPreflight([], environment())).toContain('No connection, checkout, webhook or D1 acceptance has been executed');
    expect(sandboxPreflight(['--help'], {})).toContain('makes no external requests');
  });
  it.each(['http://payments-staging.example.test', 'https://production.example.test', 'https://sandbox-production.example.com', 'https://example.com', 'https://staging.example.com/path', 'https://staging.example.com?secret=bad', 'https://user:password@staging.example.com', 'https://staging.example.com:443/path'])('rejects unsafe origin %s', value => {
    expect(() => readSandboxConfig({ ...environment(), SANDBOX_BASE_URL: value, SANDBOX_ALLOWED_ORIGINS: value })).toThrow();
  });
  it('requires exact origin and D1 allowlists, fixture acknowledgement and bounded budgets', () => {
    for (const overrides of [{ SANDBOX_ALLOWED_ORIGINS: '*' }, { SANDBOX_ALLOWED_D1_IDS: '*' }, { SANDBOX_FIXTURE_ACK: '' }, { SANDBOX_MAX_AMOUNT_MINOR: '100001' }, { SANDBOX_MAX_REQUESTS: '9999' }, { SANDBOX_MANUAL_TIMEOUT_MS: '99999999' }, { DEBUG: 'pw:api' }]) expect(() => readSandboxConfig({ ...environment(), ...overrides })).toThrow();
  });
  it('requires separate Waffo key environment attestation', () => {
    expect(() => readSandboxConfig({ ...environment('waffo'), SANDBOX_WAFFO_KEY_ENVIRONMENT: '' })).toThrow('SANDBOX_WAFFO_KEY_ATTESTATION_REQUIRED');
  });
  it('checks actual runtime mode and selected provider before checkout', () => {
    expect(() => assertRuntime({ provider: 'stripe', mode: 'test', credentialMode: 'test' }, config())).not.toThrow();
    for (const runtime of [{ provider: 'stripe', mode: 'live', credentialMode: 'test' }, { provider: 'stripe', mode: 'test', credentialMode: 'live' }, { provider: 'creem', mode: 'test', credentialMode: 'test' }, {}]) expect(() => assertRuntime(runtime, config())).toThrow();
    expect(() => assertRuntime({ provider: 'waffo', mode: 'test', credentialMode: 'unknown' }, config('waffo'))).not.toThrow();
  });
  it('refuses trials, over-budget amounts, wrong currency and unavailable plans', () => {
    const plan = { id: 'pro-monthly', amount: 1900, currency: 'usd', available: true };
    expect(() => assertPlan(plan, config())).not.toThrow();
    for (const overrides of [{ amount: 2600 }, { currency: 'EUR' }, { available: false }, { trialPeriodDays: 7 }, { id: 'lifetime' }]) expect(() => assertPlan({ ...plan, ...overrides }, config())).toThrow();
  });
  it('validates hosted URLs without leaking a URL or JWT into errors', () => {
    expect(assertHostedCheckout('https://checkout.stripe.com/c/pay/cs_test_fixture', 'stripe')).toContain('cs_test_');
    for (const url of ['https://checkout.stripe.com.evil.test/cs_test_foo#private-token', 'https://checkout.stripe.com/c/pay/cs_live_fixture#private-token', 'http://checkout.stripe.com/cs_test_foo#private-token']) {
      try { assertHostedCheckout(url, 'stripe'); throw Error('Expected failure'); }
      catch (error) { expect(String(error)).toMatch('SANDBOX_'); expect(String(error)).not.toContain('private-token'); }
    }
  });
  it.each(['stripe', 'creem', 'waffo'] as const)('checks the precise %s callback correlation, not an old order', provider => {
    const cfg = config(provider); const key = provider === 'stripe' ? 'session_id' : provider === 'creem' ? 'request_id' : 'checkout_id';
    const value = provider === 'stripe' ? 'cs_test_fixture' : 'fresh-reference';
    expect(isExpectedCallback(`${origin}/settings/payment?${key}=${value}`, cfg, 'fresh-reference', 'cs_test_fixture')).toBe(true);
    expect(isExpectedCallback(`${origin}/settings/payment?${key}=old-order`, cfg, 'fresh-reference', 'cs_test_fixture')).toBe(false);
    expect(isExpectedCallback(`https://wrong.example.test/settings/payment?${key}=${value}`, cfg, 'fresh-reference', 'cs_test_fixture')).toBe(false);
    expect(isExpectedCallback(`${origin}/settings/billing?${key}=${value}`, cfg, 'fresh-reference', 'cs_test_fixture')).toBe(false);
  });
  it('never retries an attempted checkout, including unknown outcomes', () => {
    const budget = new RequestBudget(3);
    budget.take('checkout');
    expect(() => budget.take('checkout')).toThrow('SANDBOX_CHECKOUT_RETRY_FORBIDDEN');
    budget.take(); budget.take();
    expect(() => budget.take()).toThrow('SANDBOX_REQUEST_BUDGET_EXHAUSTED');
  });
});

describe('D1 evidence verifies the authoritative current purchase', () => {
  it.each(['stripe', 'creem', 'waffo'] as const)('accepts %s authority and rejects sync-only, mismatched and expired evidence', provider => {
    const order = checkout(provider); const event = grant(order); const { status, billing } = evidence(order, event);
    expect(() => assertPaidEvidence(order, [event], status, billing)).not.toThrow();
    expect(() => assertPaidEvidence(order, [{ ...event, effect: 'sync' }], status, billing)).toThrow('SANDBOX_AUTHORITATIVE_WEBHOOK_MISSING');
    expect(() => assertPaidEvidence(order, [{ ...event, type: 'subscription.payment_succeeded' }], status, billing)).toThrow('SANDBOX_AUTHORITATIVE_WEBHOOK_MISSING');
    expect(() => assertPaidEvidence(order, [event], { ...status, reference: 'older-order' }, billing)).toThrow('SANDBOX_CURRENT_ORDER_STATUS_MISMATCH');
    expect(() => assertPaidEvidence(order, [event], status, { ...billing, entitlement: { ...billing.entitlement, userId: 'someone-else' } })).toThrow('SANDBOX_CURRENT_ENTITLEMENT_MISMATCH');
    expect(() => assertPaidEvidence(order, [{ ...event, periodEnd: Date.now() - 1 }], status, billing)).toThrow('SANDBOX_D1_ENTITLEMENT_NOT_ACTIVE');
  });
  it('requires exact persisted checkout user/provider/plan/session/time and a single row', () => {
    const order = checkout();
    const row = { reference: order.reference, user_id: order.userId, provider: order.provider, plan: JSON.stringify(order.plan), created_at: order.createdAt, session_id: order.sessionId };
    expect(parseCheckout([row], config(), order.reference, order.sessionId || '', order.createdAt)).toEqual(order);
    expect(() => parseCheckout([row, row], config(), order.reference, order.sessionId || '', order.createdAt)).toThrow('SANDBOX_CHECKOUT_COUNT_MISMATCH');
    expect(() => parseCheckout([{ ...row, user_id: 'other' }], config(), order.reference, order.sessionId || '', order.createdAt)).toThrow('SANDBOX_CHECKOUT_OWNERSHIP_MISMATCH');
    expect(() => parseCheckout([{ ...row, created_at: order.createdAt - 10_000 }], config(), order.reference, order.sessionId || '', order.createdAt)).toThrow('SANDBOX_CHECKOUT_NOT_CURRENT');
  });
  it('rejects duplicated, cross-order and stale event rows', () => {
    const order = checkout(); const event = grant(order); const row = { event_id: event.id, payload: JSON.stringify(event) };
    expect(parseEvents([row], order)).toEqual([event]);
    expect(() => parseEvents([row, row], order)).toThrow('SANDBOX_DUPLICATE_EVENT_ID');
    expect(() => parseEvents([{ ...row, payload: JSON.stringify({ ...event, checkoutReference: 'old' }) }], order)).toThrow('SANDBOX_EVENT_CORRELATION_MISMATCH');
    expect(() => parseEvents([{ ...row, payload: JSON.stringify({ ...event, occurredAt: order.createdAt - 60_000 }) }], order)).toThrow('SANDBOX_EVENT_NOT_CURRENT');
  });
  it('uses fixed SELECT statements with bound parameters and no returned secret in errors', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify({ success: true, result: [{ success: true, results: [] }] }), { status: 200 }));
    const verifier = new D1Verifier(config(), new RequestBudget(10), transport as typeof fetch);
    await verifier.select('fixture', ["user' OR 1=1 --"]);
    const [url, init] = (transport.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`);
    expect(JSON.parse(String(init.body))).toEqual({ sql: queries.fixture, params: ["user' OR 1=1 --"] });
    expect(init.redirect).toBe('error');
    expect(Object.values(queries).every(sql => /^SELECT /.test(sql) && !sql.includes(';'))).toBe(true);
    const bad = new D1Verifier(config(), new RequestBudget(10), vi.fn(async () => { throw Error('private-token secret-url'); }) as typeof fetch);
    await expect(bad.verifyDatabase()).rejects.toThrow('SANDBOX_D1_REQUEST_FAILED');
  });
});

describe('complete runner self-validation with in-memory browser and HTTP only', () => {
  function mockRun(provider: SandboxProvider, runtimeMode = 'test', scenario: SandboxScenario = 'purchase') {
    for (const [key, value] of Object.entries(environment(provider))) vi.stubEnv(key, value);
    for (const key of ['DEBUG', 'PWDEBUG', 'NODE_DEBUG']) vi.stubEnv(key, '');
    vi.stubEnv('SANDBOX_SCENARIO', scenario);
    vi.stubEnv('SANDBOX_SCENARIO_ACK', `I_AUTHORIZE_TEST_${scenario}`);
    vi.stubEnv('SANDBOX_MAX_AMOUNT_MINOR', '30000');
    if (scenario === 'plan-change') vi.stubEnv('SANDBOX_TARGET_PLAN_ID', 'pro-yearly');
    const order = checkout(provider);
    if (['full-refund', 'three-d-secure', 'zero-cost', 'decline'].includes(scenario)) { order.plan = { ...order.plan, id: 'lifetime', kind: 'one_time' }; vi.stubEnv('SANDBOX_PLAN_ID', 'lifetime'); }
    if (['three-d-secure', 'zero-cost', 'decline'].includes(scenario)) vi.stubEnv('SANDBOX_STRIPE_READ_KEY', 'rk_test_fixture');
    const event = grant(order);
    if (scenario === 'full-refund') event.type = provider === 'stripe' ? 'invoice.paid' : 'order.completed';
    const lifecycleEvent = lifecycleFixture(scenario, order, event);
    const resultFor = (changed: boolean) => projectionEvidence(order, changed ? [event, lifecycleEvent] : [event]);
    let created = false; let completed = false; let changed = false;
    const row = { reference: order.reference, user_id: order.userId, provider, plan: JSON.stringify(order.plan), created_at: order.createdAt, session_id: order.sessionId };
    const external = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (String(_url).startsWith('https://api.stripe.com/')) return Response.json({ id: order.sessionId, livemode: false, client_reference_id: order.reference, status: completed && scenario !== 'decline' ? 'complete' : 'open', amount_total: scenario === 'zero-cost' ? 0 : 1900, payment_status: completed && scenario !== 'decline' ? 'paid' : 'unpaid', payment_intent: { status: scenario === 'decline' ? 'requires_payment_method' : 'succeeded', last_payment_error: completed && scenario === 'decline' ? { code: 'card_declined' } : null, latest_charge: { paid: true, livemode: false, payment_method_details: { card: { three_d_secure: { result: 'authenticated', authentication_flow: 'challenge' } } } } } });
      if (init?.method === 'GET') return Response.json({ success: true, result: { uuid: databaseId, name: 'payments-staging' } });
      const body = JSON.parse(String(init?.body));
      const rows = body.sql === queries.fixture ? [{ id: order.userId, email: environment().SANDBOX_USER_EMAIL }] : body.sql === queries.checkouts ? created ? [row] : [] : completed && scenario !== 'decline' ? (changed ? [event, lifecycleEvent] : [event]).map(item => ({ event_id: item.id, payload: JSON.stringify(item) })) : [];
      return Response.json({ success: true, result: [{ success: true, results: rows }] });
    });
    vi.stubGlobal('fetch', external);
    const request = vi.fn(async (url: string, options: { method: string; data?: unknown }) => {
      const path = new URL(url).pathname;
      if (runState.step === `operator-${scenario}` && ['full-refund', 'renewal'].includes(scenario)) changed = true;
      const { status, billing } = resultFor(changed);
      let result: unknown;
      if (path.includes('/auth/')) result = { user: { id: order.userId, email: environment().SANDBOX_USER_EMAIL } };
      else if (options.method === 'POST' && (options.data as { action?: string })?.action === 'portal') { changed = true; result = { url: provider === 'stripe' ? 'https://billing.stripe.com/session/test' : provider === 'creem' ? 'https://creem.io/portal/test' : 'https://pancake.waffo.ai/consumer/portal/login' }; }
      else if (options.method === 'POST') {
        created = true;
        result = { reference: order.reference, sessionId: order.sessionId, url: provider === 'stripe' ? 'https://checkout.stripe.com/c/pay/cs_test_fixture' : provider === 'creem' ? 'https://checkout.creem.io/ch_test' : 'https://checkout.waffo.ai/store/checkout/CHK_test#token=secret-fixture' };
      } else if (new URL(url).searchParams.has('reference')) result = completed && scenario !== 'decline' ? status : { ...status, state: 'pending', paid: false, hasAccess: false };
      else result = completed && scenario !== 'decline' ? billing : { runtime: { provider, mode: runtimeMode, credentialMode: provider === 'waffo' ? 'unknown' : 'test' }, checkouts: created ? [{ ...status, state: 'pending', paid: false, hasAccess: false }] : [], entitlement: null, plans: [{ ...order.plan, available: true, allowPromotionCodes: true }, { ...order.plan, id: 'pro-yearly', amount: 19000, available: true }] };
      return { ok: () => true, json: async () => result };
    });
    const context = { request: { fetch: request, get: vi.fn(async () => ({ status: () => 200 })) }, route: vi.fn() };
    let navigation: (frame: unknown) => void = () => {};
    const callbackKey = provider === 'stripe' ? 'session_id' : provider === 'creem' ? 'request_id' : 'checkout_id';
    const frame = { url: () => `${origin}/settings/payment?${callbackKey}=${provider === 'stripe' ? order.sessionId : order.reference}` };
    const page = { on: (_name: string, fn: typeof navigation) => { navigation = fn; }, mainFrame: () => frame, goto: vi.fn(), getByText: vi.fn(() => ({ first: () => ({ waitFor: async () => { completed = true; if (scenario !== 'decline') navigation(frame); } }) })), isClosed: () => false };
    const info = { retry: 0, repeatEachIndex: 0, attach: vi.fn() };
    return { context, page, info, request, external };
  }
  it.each(['stripe', 'creem', 'waffo'] as const)('executes %s checkout → callback → D1 grant → fresh entitlement with sanitized evidence', async provider => {
    const mocks = mockRun(provider);
    await runSandboxAcceptance(provider, mocks.context as unknown as BrowserContext, mocks.page as unknown as Page, mocks.info as unknown as TestInfo);
    expect(mocks.request.mock.calls.filter(([url, options]) => new URL(url).pathname === '/api/payments' && options.method === 'POST')).toHaveLength(1);
    expect(mocks.page.goto).toHaveBeenCalledTimes(1);
    const report = (mocks.info.attach.mock.calls as unknown as [string, { body: Buffer }][])[0][1].body.toString();
    expect(JSON.parse(report)).toMatchObject({ provider, authenticatedReturn: true, authoritativeWebhookInD1: true, currentOrderPaid: true, execution: 'manual-assisted' });
    expect(report).not.toContain('secret-fixture'); expect(report).not.toContain('NotARealPassword'); expect(report).not.toContain('session-fixture');
    expect(mocks.external.mock.calls.every(([, init]) => init?.method !== 'POST' || String(init.body).includes('SELECT'))).toBe(true);
  });
  it.each([['stripe', 'cancel-at-period-end'], ['creem', 'cancel-at-period-end'], ['waffo', 'cancel-at-period-end'], ['stripe', 'full-refund'], ['waffo', 'full-refund'], ['waffo', 'renewal'], ['stripe', 'plan-change'], ['creem', 'plan-change'], ['waffo', 'plan-change']] as const)('executes %s %s through the real runner using only mocks', async (provider, scenario) => {
    const mocks = mockRun(provider, 'test', scenario);
    await runSandboxAcceptance(provider, mocks.context as unknown as BrowserContext, mocks.page as unknown as Page, mocks.info as unknown as TestInfo);
    const report = (mocks.info.attach.mock.calls as unknown as [string, { body: Buffer }][])[0][1].body.toString();
    expect(JSON.parse(report)).toMatchObject({ scenario, lifecycleVerified: true, hasAccess: scenario !== 'full-refund' });
    expect(mocks.request.mock.calls.filter(([, options]) => options.method === 'POST' && (options.data as { action?: string })?.action === 'checkout')).toHaveLength(1);
  });
  it.each(['three-d-secure', 'zero-cost'] as const)('executes Stripe %s with readonly provider evidence in the mocked runner', async scenario => {
    const mocks = mockRun('stripe', 'test', scenario);
    await runSandboxAcceptance('stripe', mocks.context as unknown as BrowserContext, mocks.page as unknown as Page, mocks.info as unknown as TestInfo);
    const report = JSON.parse((mocks.info.attach.mock.calls as unknown as [string, { body: Buffer }][])[0][1].body.toString());
    expect(report.scenario).toBe(scenario);
    expect(scenario === 'three-d-secure' ? report.stripeChallengeAuthenticated : report.providerAmountTotal === 0).toBe(true);
    expect(mocks.external.mock.calls.filter(([url]) => String(url).startsWith('https://api.stripe.com/'))).toHaveLength(2);
  });
  it('executes Stripe decline with a full bounded no-grant window and no checkout retry', async () => {
    vi.useFakeTimers(); runState.advanceClock = true;
    try {
      const mocks = mockRun('stripe', 'test', 'decline');
      vi.stubEnv('SANDBOX_DECLINE_OBSERVATION_MS', '10000');
      vi.stubEnv('SANDBOX_POLL_INTERVAL_MS', '2000');
      const running = runSandboxAcceptance('stripe', mocks.context as unknown as BrowserContext, mocks.page as unknown as Page, mocks.info as unknown as TestInfo);
      await running;
      const report = JSON.parse((mocks.info.attach.mock.calls as unknown as [string, { body: Buffer }][])[0][1].body.toString());
      expect(report).toMatchObject({ providerDeclineVerified: true, currentOrderPaid: false, hasAccess: false, authoritativeWebhookInD1: false });
      expect(report.noGrantObservedMs).toBeGreaterThanOrEqual(10000);
      expect(mocks.request.mock.calls.filter(([, options]) => options.method === 'POST' && (options.data as { action?: string })?.action === 'checkout')).toHaveLength(1);
    } finally { runState.advanceClock = false; vi.useRealTimers(); }
  });
  it('blocks a live-mode deployment before opening checkout or creating an order', async () => {
    const mocks = mockRun('stripe', 'live');
    await expect(runSandboxAcceptance('stripe', mocks.context as unknown as BrowserContext, mocks.page as unknown as Page, mocks.info as unknown as TestInfo)).rejects.toThrow('SANDBOX_DEPLOYED_MODE_MISMATCH');
    expect(mocks.page.goto).not.toHaveBeenCalled();
    expect(mocks.request.mock.calls.filter(([url, options]) => new URL(url).pathname === '/api/payments' && options.method === 'POST')).toHaveLength(0);
  });
});


describe('explicit scenario authority and negative checks', () => {
  it('requires scenario-specific opt-in, rejects unsupported providers and live read keys', () => {
    expect(() => readSandboxConfig({ ...environment(), SANDBOX_SCENARIO: 'full-refund' })).toThrow('SANDBOX_SCENARIO_ACK_REQUIRED');
    expect(() => readSandboxConfig({ ...environment('creem'), SANDBOX_SCENARIO: 'full-refund', SANDBOX_SCENARIO_ACK: 'I_AUTHORIZE_TEST_full-refund', SANDBOX_PLAN_ID: 'lifetime' })).toThrow('SANDBOX_PROVIDER_SCENARIO_UNSUPPORTED');
    expect(() => readSandboxConfig({ ...environment(), SANDBOX_SCENARIO: 'decline', SANDBOX_PLAN_ID: 'lifetime', SANDBOX_SCENARIO_ACK: 'I_AUTHORIZE_TEST_decline', SANDBOX_STRIPE_READ_KEY: 'sk_live_not-real' })).toThrow('SANDBOX_STRIPE_TEST_READ_KEY_REQUIRED');
  });
  it('allows zero-cost Lifetime with explicit promotion support, never a trial substitute', () => {
    const cfg = readSandboxConfig({ ...environment(), SANDBOX_PLAN_ID: 'lifetime', SANDBOX_SCENARIO: 'zero-cost', SANDBOX_SCENARIO_ACK: 'I_AUTHORIZE_TEST_zero-cost', SANDBOX_STRIPE_READ_KEY: 'rk_test_fixture' });
    expect(() => assertPlan({ id: 'lifetime', amount: 1900, currency: 'USD', available: true, allowPromotionCodes: true }, cfg)).not.toThrow();
    expect(() => assertPlan({ id: 'lifetime', amount: 1900, currency: 'USD', available: true }, cfg)).toThrow('SANDBOX_ZERO_COST_REQUIRES_PROMOTION_CODES');
  });
  it('requires Stripe authoritative declined state, authenticated challenge, or exact zero total', () => {
    const order = checkout(); const base = { id: order.sessionId, livemode: false, client_reference_id: order.reference, status: 'complete' };
    const cfg = config();
    expect(() => assertStripeScenario({ ...base, amount_total: 0, payment_status: 'no_payment_required' }, { ...cfg, scenario: 'zero-cost' }, order)).not.toThrow();
    expect(() => assertStripeScenario({ ...base, amount_total: 1, payment_status: 'paid' }, { ...cfg, scenario: 'zero-cost' }, order)).toThrow('SANDBOX_ZERO_TOTAL_NOT_VERIFIED');
    const challenge = { ...base, payment_intent: { status: 'succeeded', latest_charge: { paid: true, livemode: false, payment_method_details: { card: { three_d_secure: { result: 'authenticated', authentication_flow: 'challenge' } } } } } };
    expect(() => assertStripeScenario(challenge, { ...cfg, scenario: 'three-d-secure' }, order)).not.toThrow();
    expect(() => assertStripeScenario(base, { ...cfg, scenario: 'three-d-secure' }, order)).toThrow('SANDBOX_3DS_CHALLENGE_NOT_VERIFIED');
    const decline = { ...base, status: 'open', payment_status: 'unpaid', payment_intent: { status: 'requires_payment_method', last_payment_error: { code: 'card_declined' } } };
    expect(() => assertStripeScenario(decline, { ...cfg, scenario: 'decline' }, order)).not.toThrow();
    expect(() => assertStripeScenario(base, { ...cfg, scenario: 'decline' }, order)).toThrow('SANDBOX_PROVIDER_DECLINE_NOT_OBSERVED');
  });
  it('rejects any grant for a declined checkout and does not accept another user or order', () => {
    const order = checkout(); const pending = projectionEvidence(order, []);
    expect(() => assertNoGrant(order, [], pending.status, pending.billing)).not.toThrow();
    expect(() => assertNoGrant(order, [grant(order)], pending.status, pending.billing)).toThrow('SANDBOX_DECLINED_ORDER_GRANTED_ACCESS');
    expect(() => assertNoGrant(order, [], { ...pending.status, reference: 'other' }, pending.billing)).toThrow('SANDBOX_DECLINED_ORDER_GRANTED_ACCESS');
  });
  it('does not pass lifecycle scenarios using existing paid events or receipt-only renewals', () => {
    const order = checkout('waffo'); const event = grant(order); const paid = projectionEvidence(order, [event]);
    expect(() => assertLifecycle({ ...config('waffo'), scenario: 'renewal' }, order, [event], [event], paid.status, paid.billing)).toThrow('SANDBOX_RENEWAL_WEBHOOK_MISSING');
    const receipt = { ...event, id: 'receipt', type: 'subscription.payment_succeeded', effect: 'receipt' as const };
    expect(() => assertLifecycle({ ...config('waffo'), scenario: 'renewal' }, order, [event], [event, receipt], paid.status, paid.billing)).toThrow('SANDBOX_RENEWAL_WEBHOOK_MISSING');
  });
  it('restricts portal destinations and Stripe provider evidence to GET with test credentials', async () => {
    expect(() => assertPortalUrl('https://billing.stripe.com.evil.test/private', 'stripe')).toThrow('SANDBOX_UNTRUSTED_PORTAL_HOST');
    const transport = vi.fn(async () => Response.json({ id: 'cs_test_fixture', livemode: false }));
    await readStripeSession({ ...config(), stripeReadKey: 'rk_test_fixture' }, new RequestBudget(2), 'cs_test_fixture', transport as typeof fetch);
    const call = transport.mock.calls as unknown as [string, RequestInit][];
    expect(call[0][1].method).toBe('GET'); expect(call[0][1].redirect).toBe('error');
    expect(call[0][0]).toContain('https://api.stripe.com/v1/checkout/sessions/cs_test_fixture?');
    await expect(readStripeSession({ ...config(), stripeReadKey: 'rk_live_fake' }, new RequestBudget(2), 'cs_test_fixture', transport as typeof fetch)).rejects.toThrow('SANDBOX_STRIPE_TEST_READ_KEY_REQUIRED');
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
