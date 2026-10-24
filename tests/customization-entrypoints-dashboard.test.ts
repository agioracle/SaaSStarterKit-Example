import { AsyncLocalStorage } from 'node:async_hooks';
import { Writable } from 'node:stream';
import { createElement, type ComponentType } from 'react';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountSectionCards, SectionCards } from '../src/components/dashboard/section-cards';
import { Route as AppRoute } from '../src/routes/_app';
import { SampleChartPreview } from '../src/components/dashboard/sample-chart-preview';
import { getSidebarLinks } from '../src/config/sidebar-config';
import { getServerAsyncLocalStorage, overwriteServerAsyncLocalStorage } from '../src/locale/paraglide/runtime';
import type { Locale } from '../src/locale';
import en from '../messages/en.json';
import zh from '../messages/zh.json';

vi.mock('../src/auth/functions', () => ({ getSession: vi.fn() }));
vi.mock('../src/middlewares/auth-middleware', () => ({ authRouteMiddleware: {} }));
vi.mock('../src/auth/client', () => ({ authClient: { useSession: () => ({ data: null }), signOut: vi.fn() } }));
vi.mock('../src/config/sidebar-config', () => ({ getSidebarLinks: vi.fn(() => []) }));
const originalStorage = getServerAsyncLocalStorage();
const storage = new AsyncLocalStorage<{ locale?: Locale }>();
afterEach(() => {
  overwriteServerAsyncLocalStorage(originalStorage);
  vi.restoreAllMocks();
});
function session(role: string | null = 'user', emailVerified = true) {
  return { session: { user: { id: 'fixture-account', name: 'Fixture User', email: 'owner@example.test', role, emailVerified } } };
}
async function renderInRouter(component: ComponentType) {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '/dashboard', component: () => createElement(component) });
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ['/dashboard'] }) });
  await router.load();
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}
function renderStream(element: ReturnType<typeof createElement>): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = '';
    const output = new Writable({ write(chunk, _encoding, done) { html += chunk.toString(); done(); } });
    output.on('finish', () => resolve(html));
    const stream = renderToPipeableStream(element, {
      onAllReady() { stream.pipe(output); },
      onError(error) { reject(error); },
    });
  });
}

describe('dashboard customization entrypoints are used by real routes', () => {
  it('renders configured no-href sidebar groups through the actual workspace component', async () => {
    overwriteServerAsyncLocalStorage(storage);
    vi.spyOn(AppRoute, 'useRouteContext').mockReturnValue(session(null) as never);
    vi.mocked(getSidebarLinks).mockReturnValue([
      { title: 'Custom workspace group', items: [{ title: 'Dashboard', href: '/dashboard' }, { title: 'Member tools', href: '/settings/apikeys', authorizeOnly: ['user'] }] },
      { title: 'Private admin group', authorizeOnly: ['admin'], items: [{ title: 'Users', href: '/admin/users' }] },
    ]);
    await storage.run({ locale: 'en' }, async () => {
      const html = await renderInRouter(AppRoute.options.component as ComponentType);
      expect(html).toContain('Custom workspace group');
      expect(html).toContain('Member tools');
      expect(html).toContain('<summary>');
      expect(html).toContain('aria-current="page"');
      expect(html).not.toContain('Private admin group');
    });
  });

  it.each([['en', en], ['zh', zh]] as const)('uses actual session summaries and a disclosed lazy sample chart in %s', async (locale, messages) => {
    overwriteServerAsyncLocalStorage(storage);
    vi.spyOn(AppRoute, 'useRouteContext').mockReturnValue(session('admin', false) as never);
    await storage.run({ locale }, async () => {
      const html = await renderInRouter(() => createElement("div", null, createElement(AccountSectionCards, { user: session("admin", false).session.user }), createElement(SampleChartPreview)));
      expect(html).toContain('dashboard-section-cards');
      expect(html).toContain('owner@example.test');
      expect(html).toContain(messages.routes_app_dashboard_awaiting_verification);
      expect(html).toContain('admin');
      expect(html).toContain(messages.routes_app_dashboard_account_at_a_glance);
      expect(html).toContain(messages.dashboard_chart_sample_toggle);
      expect(html).toContain(messages.dashboard_chart_sample_description);
      // The sample visualization is not loaded/rendered in the default closed preview.
      expect(html).not.toContain('<figure');
      expect(html).not.toMatch(/revenue|conversion|\$[0-9]/i);
    });
  });

  it('renders the actual lazy chart with accessible data only after opting into the sample preview', async () => {
    overwriteServerAsyncLocalStorage(storage);
    await storage.run({ locale: 'en' }, async () => {
      const html = await renderStream(createElement(SampleChartPreview, { initiallyOpen: true }));
      expect(html).toContain(en.dashboard_chart_sample_description);
      expect(html).toContain('<figure');
      expect(html).toContain(en.dashboard_chart_sample_title);
      expect(html).toContain(en.dashboard_chart_view_data);
      expect(html).toContain('<table>');
      expect(html).toContain('<td>12</td>');
    });
  });

  it('keeps reusable cards caller-driven and escapes user account text', () => {
    overwriteServerAsyncLocalStorage(storage);
    storage.run({ locale: 'en' }, () => {
      const html = renderToStaticMarkup(createElement(SectionCards, { label: 'Project summary', cards: [{ id: 'projects', title: 'Projects', value: 7, description: 'From the caller' }] }));
      expect(html).toContain('Project summary');
      expect(html).toContain('From the caller');
      expect(html).toContain('>7</p>');
      const account = renderToStaticMarkup(createElement(AccountSectionCards, { user: { email: '<unsafe>@example.test', emailVerified: true } }));
      expect(account).toContain('&lt;unsafe&gt;@example.test');
      expect(account).toContain(en.routes_app_dashboard_verified);
      expect(account).toContain('>user</p>');
    });
  });
});
