import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { signInFixture as signIn } from './browser-session';

// Normal functional QA only: local synthetic data, disabled providers, no keys.
const evidence = process.env.EDGEKIT_QA_EVIDENCE;
async function screenshot(page: Page, name: string) {
  if (!evidence) return;
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${name}.png`), fullPage: true });
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Report hydration/runtime errors even if an otherwise static page looks fine.
  (page as Page & { acceptanceErrors?: string[] }).acceptanceErrors = errors;
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { acceptanceErrors?: string[] }).acceptanceErrors).toEqual([]);
});

for (const locale of ['en', 'zh'] as const) {
  for (const width of [1440, 390]) {
    test(`@browser ${locale} ${width}px public pages hydrate without overflow or missing names`, async ({ page }) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const path of ['/', '/pricing', '/blog', '/about', '/contact', '/roadmap', '/changelog', '/privacy', '/terms', '/cookie', '/waitlist', '/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password', '/ai']) {
        const localized = locale === 'zh' ? `/zh${path === '/' ? '' : path}` : path;
        const response = await page.goto(localized);
        expect(response?.status(), localized).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('main h1'), localized).toHaveCount(1);
        const skippedHeadings = await page.locator('main h1, main h2, main h3, main h4').evaluateAll(nodes => nodes.filter((node, index) => index > 0 && Number(node.tagName.slice(1)) > Number(nodes[index - 1].tagName.slice(1)) + 1).map(node => node.textContent));
        expect(skippedHeadings, localized).toEqual([]);
        await expect(page.locator('body')).not.toContainText('Internal Server Error');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), localized).toBe(true);
        const unnamed = await page.locator('main button, header button, main input:not([type=hidden]), main textarea, main select').evaluateAll(nodes => nodes.filter(node => {
          const el = node as HTMLInputElement;
          const visible = el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
          return visible && !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent?.trim() || el.labels?.length);
        }).map(node => node.outerHTML.slice(0, 200)));
        expect(unnamed, localized).toEqual([]);
        if (['/', '/pricing', '/blog', '/ai', '/auth/register'].includes(path)) await screenshot(page, `${locale}-${width}-${path.replaceAll('/', '') || 'home'}`);
      }
    });
  }
}

test('@browser journal pagination, locale switch, category and canonical URL stay aligned', async ({ page }) => {
  await page.goto('/blog');
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(/\/blog\?page=2$/);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', /\/blog\?page=2$/);
  await page.getByRole('combobox', { name: 'Language' }).selectOption('zh');
  await expect(page).toHaveURL(/\/zh\/blog\?page=2$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
  await page.getByRole('link', { name: '上一页', exact: true }).click();
  await expect(page).toHaveURL(/\/zh\/blog$/);
  await page.goto('/blog?page=9999&category=does-not-exist');
  await expect(page).toHaveURL(/\/blog\?page=2$/);
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', /\/blog\?page=2$/);
  await page.locator('main a.blog-card').first().click();
  await expect(page.locator('main article')).toBeVisible();
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', /\/blog\/[^?]+$/);
});

test('@browser anonymous protection, invalid credentials, reset link and provider errors are honest', async ({ page }) => {
  await page.goto('/settings/profile');
  await expect(page).toHaveURL(/\/auth\/login/);
  await page.getByLabel('Email address', { exact: true }).fill('missing@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('Local-fixture-password-123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/login/);
  await page.goto('/auth/reset-password');
  await expect(page.getByRole('button', { name: 'Update password', exact: true })).toBeDisabled();
  await page.goto('/contact');
  await page.getByLabel('Name', { exact: true }).fill('Local QA');
  await page.getByLabel('Email', { exact: true }).fill('qa@example.invalid');
  await page.getByLabel('Message', { exact: true }).fill('Local QA checks a missing mail provider.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Local QA checks a missing mail provider.');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
});

test('@browser private image Studio exposes model constraints and honestly disables unconfigured providers', async ({ page }) => {
  await signIn(page);
  await page.goto('/ai');
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.locator('#image-model option')).toHaveCount(2);
  await expect(page.locator('main')).toContainText('Image generation is not connected yet');
  await page.locator('#image-prompt').fill('A local fixture idea');
  await expect(page.getByRole('button', { name: /^Create image/ })).toBeDisabled();
  await page.locator('#image-model').selectOption('workers-flux-schnell');
  await expect(page.locator('.lm-ratios button')).toHaveCount(1);
  await expect(page.locator('#image-seed')).toHaveCount(0);
  await page.locator('#image-model').selectOption('fal-flux-schnell');
  await expect(page.locator('.lm-ratios button')).toHaveCount(5);
  await page.goto('/library');
  await page.goBack();
  await expect(page).toHaveURL(/\/studio$/);
  expect((await page.request.get('/api/ai')).status()).toBe(410);
});

test('@browser local R2 file upload, preview, cancel and delete complete through the UI', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings/files');
  await expect(page.getByText('A clean canvas', { exact: true })).toBeVisible();
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZL0AAAAASUVORK5CYII=', 'base64');
  await page.locator('input[type=file]').setInputFiles({ name: 'browser-qa.png', mimeType: 'image/png', buffer: bytes });
  const row = page.getByRole('row').filter({ hasText: 'browser-qa.png' });
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'browser-qa.png', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'browser-qa.png' });
  await expect(preview.getByRole('img')).toBeVisible();
  expect(await preview.getByRole('img').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete browser-qa.png', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Delete browser-qa.png', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete file', exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByText('A clean canvas', { exact: true })).toBeVisible();
});

test('@browser file loading, failure recovery and navigation interruption do not freeze controls', async ({ page }) => {
  await signIn(page);
  let fail = true;
  await page.route('**/api/files?*', async route => {
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
    await route.fulfill(fail ? { status: 503, json: { error: 'Local fixture unavailable' } } : { json: { files: [], hasMore: false, nextCursor: null } });
  });
  await page.goto('/settings/files');
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  fail = false;
  await page.reload();
  await expect(page.getByText('A clean canvas', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.sidebar').getByRole('link', { name: 'Profile', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByLabel('Full name', { exact: true })).toBeEditable();
});

test('@browser keyboard skip link moves focus to main content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('main-content');
});

test('@browser protected settings remain usable on a narrow screen', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/studio', '/settings/profile', '/settings/security', '/settings/files', '/settings/apikeys', '/settings/billing']) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path).toBe(true);
    await expect(page.locator('main')).not.toContainText('Internal Server Error');
  }
  await screenshot(page, 'protected-mobile-billing');
});

test('@browser repeated contact submission is bounded while a failed request is pending', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/contact', async route => {
    calls++;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 800));
    await route.fulfill({ status: 503, json: { code: 'CONFIGURATION' } });
  });
  await page.goto('/contact');
  await page.getByLabel('Name', { exact: true }).fill('Local QA');
  await page.getByLabel('Email', { exact: true }).fill('qa@example.invalid');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this local fixture message after failure.');
  const submit = page.getByRole('button', { name: 'Send message', exact: true });
  await submit.dblclick();
  await expect(submit).toBeDisabled();
  await expect(page.locator('main').getByRole('alert')).toBeVisible();
  await expect(submit).toBeEnabled();
  expect(calls).toBe(1);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this local fixture message after failure.');
});

test('@browser a late previous checkout response cannot replace the current order', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/payments?*', async route => {
    const reference = new URL(route.request().url()).searchParams.get('reference');
    if (reference === 'A') await new Promise(resolveDelay => setTimeout(resolveDelay, 700));
    await route.fulfill({ json: { reference, provider: 'stripe', planId: 'fixture', state: reference === 'A' ? 'active' : 'pending', paid: reference === 'A', hasAccess: reference === 'A', cancelAtPeriodEnd: false, lifecycle: reference === 'A' ? 'completed' : 'open', reconciliationRequired: false, canCancel: false, canManage: false, canReconcile: false } }).catch(() => {});
  });
  await page.goto('/settings/payment?reference=A&provider=stripe');
  await page.evaluate(() => window.history.pushState({}, '', '/settings/payment?reference=B&provider=stripe'));
  await expect(page.getByRole('heading', { name: 'Waiting for confirmation' })).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page).toHaveURL(/reference=B/);
  await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toHaveCount(0);
});

test('@browser optional axe WCAG 2.2 A/AA audit on public and protected pages', async ({ page }) => {
  test.setTimeout(120000);
  const axePath = process.env.EDGEKIT_QA_AXE_PATH;
  test.skip(!axePath, 'Set EDGEKIT_QA_AXE_PATH to a local axe.min.js to run automated accessibility checks.');
  const axe = readFileSync(axePath as string, 'utf8');
  const results: unknown[] = [];
  await signIn(page);
  for (const profile of [{ theme: 'light', width: 1440 }, { theme: 'dark', width: 1440 }, { theme: 'light', width: 390 }]) {
  await page.setViewportSize({ width: profile.width, height: 1000 });
  await page.goto('/');
  await page.evaluate(theme => localStorage.setItem('edgekit-theme', theme), profile.theme);
  for (const path of ['/', '/zh', '/blog', '/pricing', '/auth/register', '/settings/profile', '/settings/files', '/ai']) {
    await page.goto(path);
    await page.evaluate(axe);
    const result = await page.evaluate(async () => {
      const audit = await (window as unknown as { axe: { run: (options: unknown) => Promise<{ violations: unknown[] }> } }).axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
      return audit.violations;
    });
    results.push({ path: `${profile.theme}/${profile.width}${path}`, violations: result });
  }
  }
  await test.info().attach('axe-results', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  if (evidence) writeFileSync(resolve(evidence, 'axe-results.json'), JSON.stringify(results, null, 2));
  const violations = results.flatMap(result => (result as { path: string; violations: { id: string; nodes: { target: string[] }[] }[] }).violations.map(violation => ({ path: (result as { path: string }).path, id: violation.id, targets: violation.nodes.map(node => node.target) })));
  expect(violations).toEqual([]);
});
