import { foldPaymentEvents, hasPaymentAccess } from '../../src/payment/entitlements';
import type { PaymentEvent } from '../../src/payment/types';
import { assertLifecycle, assertNoGrant, assertPortalUrl, assertStripeScenario, readStripeSession } from './scenarios';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { readSandboxConfig, requireSandbox, SandboxError, type SandboxConfig, type SandboxProvider } from './config';
import { assertHostedCheckout, assertPaidEvidence, assertPlan, assertRuntime, D1Verifier, isExpectedCallback, parseCheckout, parseEvents, record, RequestBudget } from './verification';

async function api(request: APIRequestContext, config: SandboxConfig, budget: RequestBudget, path: string, body?: unknown, kind: 'read' | 'login' | 'checkout' = 'read'): Promise<unknown> {
  budget.take(kind);
  try {
    const response = await request.fetch(`${config.origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST', data: body,
      headers: { origin: config.origin }, maxRedirects: 0, maxRetries: 0, timeout: 15_000,
    });
    requireSandbox(response.ok(), kind === 'checkout' ? 'SANDBOX_CHECKOUT_OUTCOME_UNCERTAIN_DO_NOT_RETRY' : 'SANDBOX_APP_REQUEST_FAILED');
    return await response.json();
  } catch (error) {
    if (error instanceof SandboxError) throw error;
    throw new SandboxError(kind === 'checkout' ? 'SANDBOX_CHECKOUT_OUTCOME_UNCERTAIN_DO_NOT_RETRY' : 'SANDBOX_APP_REQUEST_FAILED');
  }
}
async function session(request: APIRequestContext, config: SandboxConfig, budget: RequestBudget): Promise<void> {
  const result = record(await api(request, config, budget, '/api/auth/get-session'));
  const user = record(result.user);
  requireSandbox(user.id === config.userId && user.email === config.email, 'SANDBOX_AUTHENTICATED_USER_MISMATCH');
}
/** Browser entry is manual-assisted by design. We never type card data, confirm a
 * purchase, solve CAPTCHA, or automate third-party terms. The operator does that. */
export async function runSandboxAcceptance(provider: SandboxProvider, context: BrowserContext, page: Page, info: TestInfo): Promise<void> {
  let phase = 'PREFLIGHT';
  try {
    const config = readSandboxConfig();
    requireSandbox(provider === config.provider && info.retry === 0 && info.repeatEachIndex === 0, 'SANDBOX_RUN_SELECTION_MISMATCH');
    const budget = new RequestBudget(config.maxRequests);
    const d1 = new D1Verifier(config, budget);
    await test.step('verify-staging-and-fixture', async () => {
      await d1.verifyDatabase();
      const users = await d1.select('fixture', [config.userId]);
      requireSandbox(users.length === 1 && users[0].id === config.userId && users[0].email === config.email, 'SANDBOX_D1_FIXTURE_MISMATCH');
      requireSandbox((await d1.select('checkouts', [config.userId])).length === 0, 'SANDBOX_FRESH_USER_REQUIRED');
      await api(context.request, config, budget, '/api/auth/sign-in/email', { email: config.email, password: config.password }, 'login');
      await session(context.request, config, budget);
    });
    phase = 'MODE_VERIFICATION';
    const before = record(await api(context.request, config, budget, '/api/payments'));
    assertRuntime(before.runtime, config);
    requireSandbox(Array.isArray(before.checkouts) && before.checkouts.length === 0 && before.entitlement === null, 'SANDBOX_FRESH_USER_REQUIRED');
    const plans = Array.isArray(before.plans) ? before.plans.map(record) : [];
    assertPlan(plans.find(plan => plan.id === config.planId), config);
    if (config.targetPlanId) assertPlan(plans.find(plan => plan.id === config.targetPlanId), { ...config, planId: config.targetPlanId });
    // Prevent app UI clicks from creating a second checkout/cancel/portal action.
    // context.request is not routed, and makes exactly one checkout request below.
    await context.route(`${config.origin}/api/payments`, route => route.request().method() === 'POST' ? route.abort('blockedbyclient') : route.continue());
    phase = 'CREATE_CHECKOUT';
    const started = Date.now();
    const created = record(await api(context.request, config, budget, '/api/payments', { action: 'checkout', planId: config.planId, returnUrl: `${config.origin}/settings/payment` }, 'checkout'));
    requireSandbox(typeof created.reference === 'string' && created.reference.length > 0 && typeof created.sessionId === 'string' && created.sessionId.length > 0, 'SANDBOX_CHECKOUT_RESPONSE_INVALID');
    const reference = created.reference;
    const sessionId = created.sessionId;
    if (provider === 'stripe') requireSandbox(sessionId.startsWith('cs_test_'), 'SANDBOX_STRIPE_LIVE_SESSION_BLOCKED');
    const hostedUrl = assertHostedCheckout(created.url, provider);
    const checkout = parseCheckout(await d1.select('checkouts', [config.userId]), config, reference, sessionId, started);
    const initial = record(await api(context.request, config, budget, `/api/payments?reference=${encodeURIComponent(reference)}`));
    requireSandbox(initial.reference === reference && initial.planId === config.planId && initial.paid === false && initial.hasAccess === false && initial.state === 'pending', 'SANDBOX_ACCESS_GRANTED_BEFORE_PAYMENT');
    const initialEvents = parseEvents(await d1.select('events', [provider, reference]), checkout);
    requireSandbox(!initialEvents.some(event => event.effect === 'grant'), 'SANDBOX_ACCESS_GRANTED_BEFORE_PAYMENT');
    const observe = async () => ({
      status: await api(context.request, config, budget, `/api/payments?reference=${encodeURIComponent(reference)}`),
      billing: await api(context.request, config, budget, '/api/payments'),
      events: parseEvents(await d1.select('events', [provider, reference]), checkout),
    });
    const saveEvidence = async (details: Record<string, unknown>) => {
      await info.attach('sandbox-evidence.json', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
        schema: 2, provider, planId: config.planId, scenario: config.scenario, mode: 'test', execution: 'manual-assisted',
        correlationHash: createHash('sha256').update(reference).digest('hex'),
        ...details, requests: budget.count, elapsedMs: Date.now() - started, observedAt: new Date().toISOString(),
      }, null, 2)) });
    };
    if (config.stripeReadKey) {
      const preflightSession = await readStripeSession(config, budget, sessionId);
      requireSandbox(preflightSession.client_reference_id === reference && preflightSession.status === 'open', 'SANDBOX_STRIPE_SCENARIO_CORRELATION_MISMATCH');
    }
    phase = 'HOSTED_CHECKOUT';
    let callbackSeen = false;
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame() && isExpectedCallback(frame.url(), config, reference, sessionId)) callbackSeen = true;
    });
    await page.goto(hostedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Official provider mode indicator, in addition to pre-checkout server mode.
    // A changed provider UI fails closed; never weaken this to "any checkout page".
    const modeText = provider === 'waffo' ? /Test Mode\s*[-–—:]?\s*No real charges will be made/i : /test mode|sandbox/i;
    await page.getByText(modeText).first().waitFor({ state: 'visible', timeout: 30_000 });
    if (config.scenario === 'decline') {
      phase = 'DECLINE';
      await test.step('operator-decline', async () => {
        let declined = false;
        const deadline = Date.now() + config.manualTimeoutMs;
        while (Date.now() < deadline) {
          const providerSession = await readStripeSession(config, budget, sessionId);
          try { assertStripeScenario(providerSession, config, checkout); declined = true; break; }
          catch (error) { if (!(error instanceof SandboxError) || error.code !== 'SANDBOX_PROVIDER_DECLINE_NOT_OBSERVED') throw error; }
          await delay(config.pollIntervalMs);
        }
        requireSandbox(declined, 'SANDBOX_PROVIDER_DECLINE_NOT_OBSERVED');
      });
      const observationStarted = Date.now();
      while (Date.now() - observationStarted < config.declineObservationMs) {
        const current = await observe();
        assertNoGrant(checkout, current.events, current.status, current.billing);
        requireSandbox(!callbackSeen, 'SANDBOX_DECLINED_ORDER_RETURNED_SUCCESS');
        await delay(config.pollIntervalMs);
      }
      const final = await observe();
      assertNoGrant(checkout, final.events, final.status, final.billing);
      assertStripeScenario(await readStripeSession(config, budget, sessionId), config, checkout);
      await session(context.request, config, budget);
      parseCheckout(await d1.select('checkouts', [config.userId]), config, reference, sessionId, started);
      await saveEvidence({ providerDeclineVerified: true, currentOrderPaid: false, hasAccess: false, noGrantObservedMs: Date.now() - observationStarted, authoritativeWebhookInD1: false });
      return;
    }
    phase = 'MANUAL_PAYMENT_AND_RETURN';
    await test.step(config.scenario === 'three-d-secure' || config.scenario === 'zero-cost' ? `operator-${config.scenario}` : 'manual-test-payment', async () => {
      const deadline = Date.now() + config.manualTimeoutMs;
      while (!callbackSeen && Date.now() < deadline) {
        requireSandbox(!page.isClosed(), 'SANDBOX_OPERATOR_CLOSED_BROWSER');
        await delay(250);
      }
      requireSandbox(callbackSeen, 'SANDBOX_CALLBACK_TIMEOUT_DO_NOT_REPAY');
    });
    phase = 'WEBHOOK_AND_D1';
    let verified = false;
    let authoritativeEvents = 0;
    let baseline: PaymentEvent[] = [];
    let lastCode = 'SANDBOX_AUTHORITATIVE_WEBHOOK_MISSING';
    await test.step('verify-webhook-ledger-and-entitlement', async () => {
      const deadline = Date.now() + config.webhookTimeoutMs;
      while (Date.now() < deadline) {
        const status = await api(context.request, config, budget, `/api/payments?reference=${encodeURIComponent(reference)}`);
        const events = parseEvents(await d1.select('events', [provider, reference]), checkout);
        if (events.some(event => event.effect === 'grant')) {
          const billing = await api(context.request, config, budget, '/api/payments');
          try {
            assertPaidEvidence(checkout, events, status, billing);
            verified = true;
            baseline = events;
            authoritativeEvents = events.filter(event => event.effect === 'grant').length;
            break;
          } catch (error) {
            if (!(error instanceof SandboxError)) throw error;
            lastCode = error.code;
          }
        }
        await delay(Math.min(config.pollIntervalMs, Math.max(0, deadline - Date.now())));
      }
      requireSandbox(verified, lastCode);
    });
    if (config.scenario === 'three-d-secure' || config.scenario === 'zero-cost') assertStripeScenario(await readStripeSession(config, budget, sessionId), config, checkout);
    const lifecycle = ['cancel-at-period-end', 'full-refund', 'renewal', 'plan-change'].includes(config.scenario);
    if (lifecycle) {
      phase = 'LIFECYCLE';
      if (config.scenario === 'plan-change' || config.scenario === 'cancel-at-period-end') {
        const portal = record(await api(context.request, config, budget, '/api/payments', { action: 'portal', returnUrl: `${config.origin}/settings/billing` }));
        await page.goto(assertPortalUrl(portal.url, provider), { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.getByText(/test mode|sandbox/i).first().waitFor({ state: 'visible', timeout: 30_000 });
      }
      await test.step(`operator-${config.scenario}`, async () => {
        const deadline = Date.now() + config.lifecycleTimeoutMs;
        let changed = false; let last = 'SANDBOX_LIFECYCLE_EVENT_MISSING';
        while (Date.now() < deadline) {
          const current = await observe();
          try { assertLifecycle(config, checkout, baseline, current.events, current.status, current.billing); changed = true; break; }
          catch (error) { if (!(error instanceof SandboxError)) throw error; last = error.code; }
          await delay(Math.min(config.pollIntervalMs, Math.max(0, deadline - Date.now())));
        }
        requireSandbox(changed, last);
      });
    }
    phase = 'SESSION_PERSISTENCE';
    await session(context.request, config, budget);
    // Fetch the protected confirmation page after callback; cookies must still work.
    budget.take();
    const confirmation = await context.request.get(`${config.origin}/settings/payment?reference=${encodeURIComponent(reference)}`, { maxRedirects: 0, maxRetries: 0, timeout: 15_000 });
    requireSandbox(confirmation.status() === 200, 'SANDBOX_AUTHENTICATED_RETURN_FAILED');
    const persisted = parseCheckout(await d1.select('checkouts', [config.userId]), config, reference, sessionId, started);
    const persistedEvents = parseEvents(await d1.select('events', [provider, reference]), persisted);
    const finalStatus = await api(context.request, config, budget, `/api/payments?reference=${encodeURIComponent(reference)}`);
    const finalBilling = await api(context.request, config, budget, '/api/payments');
    if (lifecycle) assertLifecycle(config, persisted, baseline, persistedEvents, finalStatus, finalBilling);
    else assertPaidEvidence(persisted, persistedEvents, finalStatus, finalBilling);
    const finalProjection = foldPaymentEvents(persisted, persistedEvents);
    // Only fixed non-sensitive evidence. No bodies, cookies, email, URLs or IDs.
    await saveEvidence({ authenticatedReturn: true, authoritativeWebhookInD1: true,
      currentOrderPaid: finalProjection.paid, hasAccess: hasPaymentAccess(finalProjection),
      state: finalProjection.state, entitlementFromD1Ledger: true, authoritativeEvents,
      ...(lifecycle ? { lifecycleVerified: true, targetPlanId: finalProjection.plan.id } : {}),
      ...(config.scenario === 'three-d-secure' ? { stripeChallengeAuthenticated: true } : {}),
      ...(config.scenario === 'zero-cost' ? { providerAmountTotal: 0 } : {}),
    });
  } catch (error) {
    if (error instanceof SandboxError) throw error;
    // Playwright errors can contain a JWT checkout URL or request body. Strip it.
    throw new SandboxError(`SANDBOX_${phase}_FAILED`);
  }
}
