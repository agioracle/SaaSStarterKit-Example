import { test, expect } from '@playwright/test';
import { signInFixture } from './browser-session';

// Contracts authored for an authorized browser environment. A passing Node/HTTP suite
// is not evidence that these interactions ran. Never run with live provider accounts.
const errors = new WeakMap<object, string[]>();
test.beforeEach(async ({ page }) => {
  const values: string[] = [];
  errors.set(page, values);
  page.on('pageerror', (error) => values.push(error.message));
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

for (const locale of ['en', 'zh'] as const) {
  test(`@browser ${locale} hydrated mobile menu and persisted theme controls`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(locale === 'zh' ? '/zh' : '/');
    const toggle = page.getByRole('button', { name: locale === 'zh' ? '切换菜单' : 'Toggle menu' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.main-nav')).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const theme = page.getByRole('button', { name: locale === 'zh' ? '切换主题' : 'Toggle color theme' });
    const oldTheme = await page.locator('html').getAttribute('data-theme');
    await theme.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', oldTheme === 'dark' ? 'light' : 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', oldTheme === 'dark' ? 'light' : 'dark');
  });
}

test('@browser login form and profile save update sidebar without reloading the document', async ({ page }) => {
  await page.goto('/auth/login');
  await page.getByLabel('Email address', { exact: true }).fill('e2e.member@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('E2eFixturePassword!23');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/studio/);
  await page.locator('.sidebar').getByRole('link', { name: 'Profile', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/profile/);
  await page.evaluate(() => { (window as unknown as { testDocumentIdentity: string }).testDocumentIdentity = 'same-document'; });
  const name = page.getByLabel('Full name', { exact: true });
  const original = await name.inputValue();
  try {
    await name.fill('E2E profile updated');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('.sidebar-user strong')).toHaveText('E2E profile updated');
    expect(await page.evaluate(() => (window as unknown as { testDocumentIdentity: string }).testDocumentIdentity)).toBe('same-document');
  } finally {
    await name.fill(original);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('.sidebar-user strong')).toHaveText(original);
  }
});

test('@browser API key dialog has keyboard focus containment, Escape and focus return', async ({ page }) => {
  await signInFixture(page);
  await page.goto('/settings/apikeys');
  const trigger = page.getByRole('button', { name: 'Create API key', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Create API key' });
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Opening/closing only; this contract does not create any API credential.
});

test('@browser file upload and last-row deletion invalidate cached pagination', async ({ page }) => {
  await signInFixture(page);
  const stored = (id: string, name: string) => ({ id, name, contentType: 'application/octet-stream', size: 12, url: `/api/files/${id}`, createdAt: '2026-01-01' });
  let uploaded = false;
  let deleted = false;
  await page.route('**/api/files*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/files') return route.fallback();
    if (route.request().method() === 'POST') {
      uploaded = true;
      return route.fulfill({ json: stored('new', 'new-upload.png') });
    }
    if (route.request().method() === 'DELETE') {
      deleted = true;
      return route.fulfill({ json: { success: true } });
    }
    const later = url.searchParams.get('cursor') === 'next';
    return route.fulfill({ json: {
      files: later ? deleted ? [] : [stored('last', 'last.txt')]
        : [stored('first', 'first.txt'), ...(uploaded ? [stored('new', 'new-upload.png')] : [])],
      hasMore: !later && !deleted,
      nextCursor: later || deleted ? null : 'next',
    } });
  });
  await page.goto('/settings/files');
  await expect(page.getByText('first.txt', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('last.txt', { exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: 'new-upload.png', mimeType: 'image/png', buffer: Buffer.from('local UI fixture') });
  await expect(page.getByText('new-upload.png', { exact: true })).toBeVisible();
  await expect(page.locator('.pagination')).toContainText('Page 1');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Delete last.txt', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete file?' });
  await dialog.getByRole('button', { name: 'Delete file', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.pagination')).toContainText('Page 1');
  await expect(page.getByText('new-upload.png', { exact: true })).toBeVisible();
});

test('@browser checkout search navigation and Back/Forward never borrow another reference success', async ({ page }) => {
  await signInFixture(page);
  await page.route('**/api/payments?*', async (route) => {
    const reference = new URL(route.request().url()).searchParams.get('reference');
    return route.fulfill({ json: {
      reference, provider: 'stripe', planId: 'fixture', state: reference === 'A' ? 'active' : 'pending',
      paid: reference === 'A', hasAccess: reference === 'A', cancelAtPeriodEnd: false,
      lifecycle: reference === 'A' ? 'completed' : 'open', reconciliationRequired: false,
      canCancel: false, canManage: false, canReconcile: false,
    } });
  });
  await page.goto('/settings/payment?reference=A&provider=stripe');
  await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
  await page.evaluate(() => {
    window.history.pushState({}, '', '/settings/payment?reference=B&provider=stripe');
  });
  await expect(page.getByRole('heading', { name: 'Waiting for confirmation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Waiting for confirmation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toHaveCount(0);
});
