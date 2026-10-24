import { foldPaymentEvents, hasPaymentAccess } from '../../src/payment/entitlements';
import type { CheckoutRecord, PaymentEvent } from '../../src/payment/types';
import { requireSandbox, SandboxError, type SandboxConfig, type SandboxProvider } from './config';
import { assertPaidEvidence, record, type RequestBudget } from './verification';

export function assertPortalUrl(value: unknown, provider: SandboxProvider): string {
  requireSandbox(typeof value === 'string', 'SANDBOX_INVALID_PORTAL_URL');
  let url: URL;
  try { url = new URL(value); } catch { throw new SandboxError('SANDBOX_INVALID_PORTAL_URL'); }
  const hosts = provider === 'stripe' ? ['billing.stripe.com'] : provider === 'creem' ? ['creem.io', 'www.creem.io', 'checkout.creem.io'] : ['pancake.waffo.ai'];
  requireSandbox(url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname), 'SANDBOX_UNTRUSTED_PORTAL_HOST');
  return value;
}
/** GET only, fixed Stripe endpoint, test key only. No payment methods are created. */
export async function readStripeSession(config: SandboxConfig, budget: RequestBudget, sessionId: string, transport: typeof fetch = fetch): Promise<Record<string, unknown>> {
  requireSandbox(config.provider === 'stripe' && /^(sk|rk)_test_/.test(config.stripeReadKey || '') && /^cs_test_[A-Za-z0-9_]+$/.test(sessionId), 'SANDBOX_STRIPE_TEST_READ_KEY_REQUIRED');
  budget.take();
  try {
    const params = new URLSearchParams({ 'expand[0]': 'payment_intent.latest_charge' });
    const response = await transport(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?${params}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${config.stripeReadKey}` },
    });
    requireSandbox(response.ok, 'SANDBOX_STRIPE_READ_FAILED');
    const result = record(await response.json());
    requireSandbox(result.livemode === false && result.id === sessionId, 'SANDBOX_STRIPE_READ_MODE_MISMATCH');
    return result;
  } catch (error) {
    if (error instanceof SandboxError) throw error;
    throw new SandboxError('SANDBOX_STRIPE_READ_FAILED');
  }
}
export function assertStripeScenario(session: Record<string, unknown>, config: SandboxConfig, checkout: CheckoutRecord): void {
  requireSandbox(session.livemode === false && session.id === checkout.sessionId && session.client_reference_id === checkout.reference, 'SANDBOX_STRIPE_SCENARIO_CORRELATION_MISMATCH');
  const payment = record(session.payment_intent);
  if (config.scenario === 'decline') {
    const failure = record(payment.last_payment_error);
    requireSandbox(session.status === 'open' && session.payment_status === 'unpaid' && payment.status === 'requires_payment_method' && failure.code === 'card_declined', 'SANDBOX_PROVIDER_DECLINE_NOT_OBSERVED');
  } else {
    requireSandbox(session.status === 'complete', 'SANDBOX_STRIPE_SESSION_NOT_COMPLETE');
    if (config.scenario === 'zero-cost') requireSandbox(session.amount_total === 0 && ['paid', 'no_payment_required'].includes(String(session.payment_status)), 'SANDBOX_ZERO_TOTAL_NOT_VERIFIED');
    if (config.scenario === 'three-d-secure') {
      const charge = record(payment.latest_charge);
      const threeDS = record(record(record(charge.payment_method_details).card).three_d_secure);
      requireSandbox(payment.status === 'succeeded' && charge.livemode === false && charge.paid === true && threeDS.result === 'authenticated' && threeDS.authentication_flow === 'challenge', 'SANDBOX_3DS_CHALLENGE_NOT_VERIFIED');
    }
  }
}
export function assertNoGrant(checkout: CheckoutRecord, events: PaymentEvent[], statusValue: unknown, billingValue: unknown): void {
  const status = record(statusValue); const billing = record(billingValue);
  requireSandbox(!events.some(event => event.effect === 'grant') && !hasPaymentAccess(foldPaymentEvents(checkout, events)), 'SANDBOX_DECLINED_ORDER_GRANTED_ACCESS');
  requireSandbox(status.reference === checkout.reference && status.planId === checkout.plan.id && status.paid === false && status.hasAccess === false && billing.entitlement === null, 'SANDBOX_DECLINED_ORDER_GRANTED_ACCESS');
  const orders = Array.isArray(billing.checkouts) ? billing.checkouts.map(record) : [];
  requireSandbox(orders.length === 1 && orders[0].reference === checkout.reference && orders[0].paid === false && orders[0].hasAccess === false, 'SANDBOX_DECLINED_ORDER_GRANTED_ACCESS');
}
export function assertLifecycle(config: SandboxConfig, checkout: CheckoutRecord, baseline: PaymentEvent[], events: PaymentEvent[], statusValue: unknown, billingValue: unknown): void {
  const oldIds = new Set(baseline.map(event => event.id));
  const fresh = events.filter(event => !oldIds.has(event.id));
  const previous = foldPaymentEvents(checkout, baseline);
  const projected = foldPaymentEvents(checkout, events);
  const status = record(statusValue); const billing = record(billingValue);
  if (config.scenario === 'full-refund') {
    const type = config.provider === 'stripe' ? 'charge.refunded' : 'refund.succeeded';
    requireSandbox(fresh.some(event => event.type === type && event.effect === 'revoke'), 'SANDBOX_REFUND_WEBHOOK_MISSING');
    requireSandbox(projected.state === 'refunded' && !hasPaymentAccess(projected) && status.reference === checkout.reference && status.state === 'refunded' && status.hasAccess === false && billing.entitlement === null, 'SANDBOX_REFUND_ENTITLEMENT_NOT_REVOKED');
    const orders = Array.isArray(billing.checkouts) ? billing.checkouts.map(record) : [];
    requireSandbox(orders.length === 1 && orders[0].reference === checkout.reference && orders[0].state === 'refunded' && orders[0].hasAccess === false, 'SANDBOX_REFUND_CURRENT_ORDER_MISMATCH');
    return;
  }
  assertPaidEvidence(checkout, events, status, billing);
  if (config.scenario === 'cancel-at-period-end') {
    const type = config.provider === 'stripe' ? 'customer.subscription.updated' : config.provider === 'creem' ? 'subscription.scheduled_cancel' : 'subscription.canceling';
    requireSandbox(fresh.some(event => event.type === type && event.cancelAtPeriodEnd === true), 'SANDBOX_CANCEL_WEBHOOK_MISSING');
    requireSandbox(projected.cancelAtPeriodEnd && projected.periodEnd === previous.periodEnd && status.cancelAtPeriodEnd === true && record(billing.entitlement).cancelAtPeriodEnd === true, 'SANDBOX_CANCEL_STATE_MISMATCH');
  } else if (config.scenario === 'renewal') {
    requireSandbox(fresh.some(event => event.type === 'subscription.renewed' && event.effect === 'grant'), 'SANDBOX_RENEWAL_WEBHOOK_MISSING');
    requireSandbox(Number(projected.periodEnd) > Number(previous.periodEnd), 'SANDBOX_RENEWAL_PERIOD_NOT_ADVANCED');
  } else if (config.scenario === 'plan-change') {
    const type = config.provider === 'stripe' ? 'invoice.paid' : config.provider === 'creem' ? 'subscription.paid' : 'subscription.plan_changed';
    requireSandbox(fresh.some(event => event.type === type && event.effect === 'grant' && event.plan?.id === config.targetPlanId), 'SANDBOX_PLAN_CHANGE_WEBHOOK_MISSING');
    requireSandbox(projected.plan.id === config.targetPlanId && projected.plan.amount <= config.maxAmountMinor && projected.plan.currency.toUpperCase() === config.currency, 'SANDBOX_PLAN_CHANGE_TARGET_MISMATCH');
  } else throw new SandboxError('SANDBOX_INVALID_LIFECYCLE_SCENARIO');
}
