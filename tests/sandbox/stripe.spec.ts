import { test } from '@playwright/test';
import { runSandboxAcceptance } from './runner';
test('stripe manual-assisted sandbox checkout, webhook and D1 entitlement', async ({ context, page }, info) => {
  await runSandboxAcceptance('stripe', context, page, info);
});
