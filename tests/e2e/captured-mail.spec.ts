import { test, expect } from '@playwright/test';

// Run ONLY in the independent checkout prepared by tests/manual/prepare-browser-fixture.ts.
// It uses the actual compiled Better Auth handlers and local D1/KV. No mail is sent.
test('@captured-browser registration, verification, sign-in, reset and sign-out use real auth', async ({ page }) => {
  test.skip(!process.env.EDGEKIT_CAPTURED_MAIL_FIXTURE, 'Requires the isolated captured-mail build; never a normal or deployed Worker.');
  const email = `browser.qa.${Date.now()}@example.invalid`;
  const password = 'Local-fixture-password-123!';
  const replacement = 'Replacement-fixture-password-456!';
  async function mailLink(path: string) {
    let link = '';
    await expect.poll(async () => {
      const response = await page.request.get(`/__local_fixture/mail?to=${encodeURIComponent(email)}`);
      expect(response.ok()).toBe(true);
      const mail = await response.json() as { html?: string };
      link = [...(mail.html || '').matchAll(/href="([^"]+)"/g)].find(value => value[1].includes(path))?.[1].replaceAll('&amp;', '&') || '';
      return !!link;
    }).toBe(true);
    return link;
  }
  await page.goto('/auth/register');
  await page.getByLabel('Full name', { exact: true }).fill('Browser QA');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /account has been created/i })).toBeVisible();
  await page.goto(await mailLink('/verify-email'));
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.locator('.sidebar-user strong')).toHaveText('Browser QA');
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://127.0.0.1:4173' }, data: {} });
  await page.goto('/auth/login');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://127.0.0.1:4173' }, data: {} });
  await page.goto('/auth/forgot-password');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send reset instructions', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /If an account exists/i })).toBeVisible();
  await page.goto(await mailLink('/reset-password'));
  await page.getByLabel('Password', { exact: true }).fill(replacement);
  await page.getByLabel('Confirm password', { exact: true }).fill(replacement);
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /Password updated/i })).toBeVisible();
  await page.goto('/auth/login');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(replacement);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await page.getByRole('button', { name: /Sign out/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/settings/profile');
  await expect(page).toHaveURL(/\/auth\/login/);
});
