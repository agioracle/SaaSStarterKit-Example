import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FullConfig, FullResult, Reporter, TestCase, TestError, TestResult, TestStep } from '@playwright/test/reporter';
/** Deliberately never forward error stacks, captured stdout or Playwright call logs. */
export default class SandboxReporter implements Reporter {
  private outputDir = '';
  printsToStdio(): boolean { return true; }
  onBegin(config: FullConfig): void { this.outputDir = config.projects[0].outputDir; process.stdout.write('Sandbox acceptance: manual-assisted, one checkout, no retries.\n'); }
  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep): void {
    const instructions: Record<string, string> = {
      'operator-decline': 'Use the official Stripe declined test card once. Do not then retry with a successful card. Waiting for Stripe last_payment_error plus a no-grant observation window.',
      'operator-three-d-secure': 'Use the official Stripe 3DS-required test card and complete the test challenge yourself. A frictionless or ordinary success does not pass this scenario.',
      'operator-zero-cost': 'Apply the prepared 100% test promotion code. Verify the hosted total is exactly zero, then complete checkout. Waiting for both Stripe zero total and invoice.paid in D1.',
      'operator-cancel-at-period-end': 'In the test-only portal, schedule cancellation at period end for this newly created subscription. Do not cancel immediately. Waiting for the authoritative webhook and retained access.',
      'operator-plan-change': 'In the test-only portal, change this subscription to SANDBOX_TARGET_PLAN_ID and confirm its test total within your budget. Waiting for the paid target-plan webhook and D1 entitlement.',
      'operator-full-refund': 'In the official provider TEST dashboard, fully refund this newly created Lifetime test order. Do not touch real orders. Waiting for the refund webhook and revoked D1 access.',
      'operator-renewal': 'In the official Waffo TEST dashboard, locate this new subscription and choose Simulate renewal success once. Waiting for subscription.renewed with an advanced D1 period.',
    };
    if (instructions[step.title]) process.stdout.write(`${instructions[step.title]}\n`);
    if (step.title === 'manual-test-payment') process.stdout.write('Provider TEST MODE verified. In the opened browser, use only the provider’s documented test card, check the total against your budget, and complete the test payment. Complete any required terms yourself. Return to the app (Waffo: click Done). Never retry a payment after a timeout.\n');
  }
  onTestEnd(_test: TestCase, result: TestResult): void {
    process.stdout.write(`Sandbox case: ${result.status}.\n`);
    for (const error of result.errors) this.onError(error);
    const evidence = result.attachments.find(item => item.name === 'sandbox-evidence.json');
    if (result.status === 'passed' && evidence?.body && evidence.body.length <= 4096) {
      mkdirSync(this.outputDir, { recursive: true });
      writeFileSync(join(this.outputDir, 'sandbox-evidence.json'), evidence.body, { mode: 0o600 });
      process.stdout.write('Sanitized evidence saved in the sandbox output directory.\n');
    }
  }
  onError(error: TestError): void {
    const code = error.message?.match(/\bSANDBOX_[A-Z_]+\b/)?.[0] ?? 'SANDBOX_RUN_FAILED';
    process.stderr.write(`${code}. See docs/provider-acceptance.md; do not repeat checkout automatically.\n`);
  }
  onEnd(result: FullResult): void { process.stdout.write(`Sandbox acceptance: ${result.status}.\n`); }
}
