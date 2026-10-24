/** No dotenv loading: a sandbox run never inherits .dev.vars or a production default. */
export type SandboxProvider = 'stripe' | 'creem' | 'waffo';
export type SandboxScenario = 'purchase' | 'decline' | 'three-d-secure' | 'zero-cost' | 'cancel-at-period-end' | 'full-refund' | 'renewal' | 'plan-change';
export type SandboxPlan = 'pro-monthly' | 'pro-yearly' | 'lifetime';
export class SandboxError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'SandboxError'; }
}
export function requireSandbox(condition: unknown, code: string): asserts condition {
  if (!condition) throw new SandboxError(code);
}
export interface SandboxConfig {
  provider: SandboxProvider;
  scenario: SandboxScenario;
  targetPlanId?: SandboxPlan;
  stripeReadKey?: string;
  lifecycleTimeoutMs: number;
  declineObservationMs: number;
  planId: SandboxPlan;
  origin: string;
  userId: string;
  email: string;
  password: string;
  accountId: string;
  databaseId: string;
  cloudflareToken: string;
  maxAmountMinor: number;
  currency: string;
  manualTimeoutMs: number;
  webhookTimeoutMs: number;
  pollIntervalMs: number;
  maxRequests: number;
  waffoKeyEnvironment?: 'test';
}
const stagingLabel = /(^|[.-])(staging|sandbox|test|preview)([.-]|$)/i;
const productionLabel = /(^|[.-])(prod|production|live)([.-]|$)/i;
export function isStagingName(value: string): boolean {
  return stagingLabel.test(value) && !productionLabel.test(value);
}
function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  requireSandbox(typeof value === 'string' && value.length > 0, `SANDBOX_MISSING_${name}`);
  return value;
}
function integer(env: NodeJS.ProcessEnv, name: string, fallback: number | undefined, min: number, max: number): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  requireSandbox(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max, `SANDBOX_INVALID_${name}`);
  return Number(value);
}
export function readSandboxConfig(env: NodeJS.ProcessEnv = process.env): SandboxConfig {
  requireSandbox(env.SANDBOX_RUN === 'I_UNDERSTAND_TEST_ONLY', 'SANDBOX_OPT_IN_REQUIRED');
  requireSandbox(env.SANDBOX_OPERATOR_ACK === 'TEST_CARDS_ONLY', 'SANDBOX_OPERATOR_ACK_REQUIRED');
  requireSandbox(env.SANDBOX_ENVIRONMENT === 'staging', 'SANDBOX_STAGING_REQUIRED');
  requireSandbox(env.SANDBOX_FIXTURE_ACK === 'DEDICATED_DISPOSABLE_USER', 'SANDBOX_FIXTURE_ACK_REQUIRED');
  requireSandbox(!env.DEBUG && !env.PWDEBUG && !env.NODE_DEBUG, 'SANDBOX_DEBUG_LOGGING_FORBIDDEN');
  const provider = required(env, 'SANDBOX_PROVIDER');
  requireSandbox(['stripe', 'creem', 'waffo'].includes(provider), 'SANDBOX_INVALID_PROVIDER');
  const planId = required(env, 'SANDBOX_PLAN_ID');
  requireSandbox(['pro-monthly', 'pro-yearly', 'lifetime'].includes(planId), 'SANDBOX_INVALID_PLAN');
  const scenario = env.SANDBOX_SCENARIO || 'purchase';
  requireSandbox(['purchase', 'decline', 'three-d-secure', 'zero-cost', 'cancel-at-period-end', 'full-refund', 'renewal', 'plan-change'].includes(scenario), 'SANDBOX_INVALID_SCENARIO');
  if (scenario !== 'purchase') requireSandbox(env.SANDBOX_SCENARIO_ACK === `I_AUTHORIZE_TEST_${scenario}`, 'SANDBOX_SCENARIO_ACK_REQUIRED');
  if (['decline', 'three-d-secure', 'zero-cost'].includes(scenario)) requireSandbox(provider === 'stripe', 'SANDBOX_PROVIDER_SCENARIO_UNSUPPORTED');
  if (scenario === 'renewal') requireSandbox(provider === 'waffo', 'SANDBOX_PROVIDER_SCENARIO_UNSUPPORTED');
  if (scenario === 'full-refund') requireSandbox(provider !== 'creem' && planId === 'lifetime', 'SANDBOX_PROVIDER_SCENARIO_UNSUPPORTED');
  if (scenario === 'three-d-secure' || scenario === 'decline') requireSandbox(planId === 'lifetime', 'SANDBOX_STRIPE_PAYMENT_INTENT_SCENARIO_REQUIRES_LIFETIME');
  if (['cancel-at-period-end', 'renewal', 'plan-change'].includes(scenario)) requireSandbox(planId !== 'lifetime', 'SANDBOX_SCENARIO_REQUIRES_SUBSCRIPTION');
  const targetPlanId = scenario === 'plan-change' ? required(env, 'SANDBOX_TARGET_PLAN_ID') : undefined;
  if (targetPlanId) requireSandbox(['pro-monthly', 'pro-yearly'].includes(targetPlanId) && targetPlanId !== planId, 'SANDBOX_INVALID_TARGET_PLAN');
  const stripeReadKey = ['decline', 'three-d-secure', 'zero-cost'].includes(scenario) ? required(env, 'SANDBOX_STRIPE_READ_KEY') : undefined;
  if (stripeReadKey) requireSandbox(/^(sk|rk)_test_/.test(stripeReadKey), 'SANDBOX_STRIPE_TEST_READ_KEY_REQUIRED');
  let url: URL;
  try { url = new URL(required(env, 'SANDBOX_BASE_URL')); } catch { throw new SandboxError('SANDBOX_INVALID_ORIGIN'); }
  requireSandbox(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' && !url.port, 'SANDBOX_HTTPS_ORIGIN_REQUIRED');
  requireSandbox(isStagingName(url.hostname), 'SANDBOX_STAGING_HOST_REQUIRED');
  const origins = required(env, 'SANDBOX_ALLOWED_ORIGINS').split(',').map(value => value.trim());
  requireSandbox(origins.includes(url.origin) && origins.every(value => !value.includes('*')), 'SANDBOX_ORIGIN_NOT_ALLOWLISTED');
  const accountId = required(env, 'SANDBOX_CLOUDFLARE_ACCOUNT_ID');
  requireSandbox(/^[a-f0-9]{32}$/i.test(accountId), 'SANDBOX_INVALID_ACCOUNT_ID');
  const databaseId = required(env, 'SANDBOX_D1_DATABASE_ID');
  requireSandbox(/^[a-f0-9-]{36}$/i.test(databaseId), 'SANDBOX_INVALID_DATABASE_ID');
  const databaseIds = required(env, 'SANDBOX_ALLOWED_D1_IDS').split(',').map(value => value.trim());
  requireSandbox(databaseIds.includes(databaseId) && !databaseIds.includes('*'), 'SANDBOX_DATABASE_NOT_ALLOWLISTED');
  const email = required(env, 'SANDBOX_USER_EMAIL');
  const userId = required(env, 'SANDBOX_USER_ID');
  const password = required(env, 'SANDBOX_USER_PASSWORD');
  requireSandbox(email.includes('@') && email.length < 255 && userId.length < 256 && password.length >= 12, 'SANDBOX_INVALID_FIXTURE');
  const currency = required(env, 'SANDBOX_CURRENCY').toUpperCase();
  requireSandbox(/^[A-Z]{3}$/.test(currency), 'SANDBOX_INVALID_CURRENCY');
  if (provider === 'waffo') requireSandbox(env.SANDBOX_WAFFO_KEY_ENVIRONMENT === 'test', 'SANDBOX_WAFFO_KEY_ATTESTATION_REQUIRED');
  return {
    provider: provider as SandboxProvider, scenario: scenario as SandboxScenario,
    ...(targetPlanId ? { targetPlanId: targetPlanId as SandboxPlan } : {}), ...(stripeReadKey ? { stripeReadKey } : {}),
    lifecycleTimeoutMs: integer(env, 'SANDBOX_LIFECYCLE_TIMEOUT_MS', 180_000, 10_000, 600_000),
    declineObservationMs: integer(env, 'SANDBOX_DECLINE_OBSERVATION_MS', 30_000, 10_000, 120_000),
    planId: planId as SandboxPlan, origin: url.origin,
    userId, email, password, accountId, databaseId,
    cloudflareToken: required(env, 'SANDBOX_CLOUDFLARE_API_TOKEN'),
    maxAmountMinor: integer(env, 'SANDBOX_MAX_AMOUNT_MINOR', undefined, 1, 100_000), currency,
    manualTimeoutMs: integer(env, 'SANDBOX_MANUAL_TIMEOUT_MS', 300_000, 30_000, 600_000),
    webhookTimeoutMs: integer(env, 'SANDBOX_WEBHOOK_TIMEOUT_MS', 180_000, 10_000, 300_000),
    pollIntervalMs: integer(env, 'SANDBOX_POLL_INTERVAL_MS', 5_000, 2_000, 30_000),
    maxRequests: integer(env, 'SANDBOX_MAX_REQUESTS', scenario === 'purchase' ? 150 : 300, 20, 300),
    ...(provider === 'waffo' ? { waffoKeyEnvironment: 'test' as const } : {}),
  };
}
