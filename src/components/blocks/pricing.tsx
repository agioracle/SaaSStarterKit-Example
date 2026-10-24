import { m } from '../../locale/paraglide/messages';
import { getPlanLabel } from '../../config/plan-messages';
import { useState } from 'react';
import { Check, ArrowUpRight } from 'lucide-react';
import { authClient } from '../../auth/client';
import { publicPlans, type PlanDefinition } from '../../config/plans';
import { websiteConfig } from '../../config/website';
import { Button, Notice, api, errorMessage } from '../ui/core';
import { localePath, getLocale } from '../../locale';
export function visiblePricingPlans(plans: readonly PlanDefinition[], annual: boolean) {
  return plans.filter(
    (plan) =>
      !plan.disabled &&
      (plan.kind !== 'subscription' || plan.interval === (annual ? 'year' : 'month')),
  );
}
export function formatPlanAmount(amount: number, currency: string, locale = 'en-US') {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amount / 10 ** digits);
}
export function PricingSection({ headingLevel = 2 }: { headingLevel?: 1 | 2 } = {}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const [annual, setAnnual] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const { data: session } = authClient.useSession();
  const plans = visiblePricingPlans(publicPlans, annual);
  return (
    <section className="section container" id="pricing">
      <div className="center-heading">
        <span className="eyebrow">{m.blocks_pricing_room_to_grow()}</span>
        <Heading>{m.blocks_pricing_start_small_go_further()}</Heading>
        <p>{m.blocks_pricing_a_simple_plan_for_every_stage_of()}</p>
        <div className="segmented">
          <button
            type="button"
            className={!annual ? 'active' : ''}
            onClick={() => setAnnual(false)}
          >
            {m.blocks_pricing_monthly()}
          </button>
          <button type="button" className={annual ? 'active' : ''} onClick={() => setAnnual(true)}>
            {m.blocks_pricing_yearly()}
          </button>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {!websiteConfig.payment.enabled && (
        <Notice>{m.blocks_pricing_paid_plans_are_not_enabled_on_this()}</Notice>
      )}
      <div className="pricing-grid">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`pricing-card ${plan.id.startsWith('pro') ? 'featured' : ''}`}
          >
            {plan.id.startsWith('pro') && (
              <span className="popular-label">{m.blocks_pricing_a_little_more_possibility()}</span>
            )}
            <span className="eyebrow">{getPlanLabel(plan.name)}</span>
            <p>{getPlanLabel(plan.description)}</p>
            <div className="price">
              <strong>{formatPlanAmount(plan.amount, plan.currency, getLocale())}</strong>
              <span>
                {'interval' in plan
                  ? plan.interval === 'year'
                    ? m.blocks_pricing_year()
                    : m.blocks_pricing_month()
                  : plan.kind === 'free'
                    ? m.blocks_pricing_forever()
                    : m.blocks_pricing_once()}
              </span>
            </div>
            <Button
              variant={plan.id.startsWith('pro') ? 'primary' : 'secondary'}
              disabled={
                !websiteConfig.auth.enabled ||
                (plan.kind !== 'free' && !websiteConfig.payment.enabled) ||
                (!!busy && busy !== plan.id)
              }
              busy={busy === plan.id}
              onClick={async () => {
                if (plan.kind === 'free') {
                  window.location.assign(localePath(session ? '/dashboard' : '/auth/register'));
                  return;
                }
                if (!session) {
                  window.location.assign(
                    `${localePath('/auth/login')}?redirect=${encodeURIComponent('/pricing')}`,
                  );
                  return;
                }
                setBusy(plan.id);
                setError('');
                try {
                  const result = await api<{ url: string }>('/api/payments', {
                    method: 'POST',
                    body: JSON.stringify({
                      action: 'checkout',
                      planId: plan.id,
                      returnUrl: window.location.origin + localePath('/settings/payment'),
                    }),
                  });
                  window.location.assign(result.url);
                } catch (error) {
                  setError(errorMessage(error));
                  setBusy('');
                }
              }}
            >
              {plan.kind === 'free'
                ? m.blocks_pricing_get_started()
                : m.blocks_pricing_choose_plan()}
              <ArrowUpRight size={16} />
            </Button>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Check size={15} />
                  {getPlanLabel(feature)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="fine-print center">
        {m.blocks_pricing_example_starter_catalog_paid_checkout_requires_configured()}
      </p>
    </section>
  );
}
