import { test } from '@playwright/test';
import { runSandboxAcceptance } from './runner';
test('creem manual-assisted sandbox checkout, webhook and D1 entitlement', async ({ context, page }, info) => {
  await runSandboxAcceptance('creem', context, page, info);
});
