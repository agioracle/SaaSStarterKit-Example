import { test } from '@playwright/test';
import { runSandboxAcceptance } from './runner';
test('waffo manual-assisted sandbox checkout, webhook and D1 entitlement', async ({ context, page }, info) => {
  await runSandboxAcceptance('waffo', context, page, info);
});
