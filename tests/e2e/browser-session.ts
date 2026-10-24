import { expect, type Page, type APIRequestContext } from '@playwright/test';

type Cookies = Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'];
const cookiesByRole = new Map<string, Cookies>();

/** One real fixture sign-in per role/worker. Reuse its cookies without weakening
 * the production auth limiter merely to log in repeatedly during a fast suite. */
export async function signInFixture(page: Page, role = 'member') {
  let cookies = cookiesByRole.get(role);
  if (!cookies) {
    const response = await page.request.post('/api/auth/sign-in/email', {
      headers: { origin: 'http://127.0.0.1:4173' },
      data: { email: `e2e.${role}@example.invalid`, password: 'E2eFixturePassword!23' },
    });
    expect(response.ok(), `Fixture sign-in returned HTTP ${response.status()}`).toBe(true);
    cookies = (await page.request.storageState()).cookies;
    cookiesByRole.set(role, cookies);
  }
  await page.context().addCookies(cookies);
}
