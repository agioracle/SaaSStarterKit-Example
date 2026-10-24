import { AsyncLocalStorage } from 'node:async_hooks';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { SidebarNavigation, sidebarHref, visibleSidebarItems } from '../src/components/layout/sidebar-navigation';
import type { MenuItemConfig } from '../src/config/menu';
import { getServerAsyncLocalStorage, overwriteServerAsyncLocalStorage } from '../src/locale/paraglide/runtime';
import type { Locale } from '../src/locale';

const originalStorage = getServerAsyncLocalStorage();
const storage = new AsyncLocalStorage<{ locale?: Locale }>();
afterEach(() => overwriteServerAsyncLocalStorage(originalStorage));
function IconFixture() { return createElement('svg', { 'data-icon': 'custom', 'aria-hidden': true }); }
const nestedItems: MenuItemConfig[] = [
  { title: 'Dashboard', href: '/dashboard', icon: IconFixture },
  {
    title: 'Workspace settings', icon: IconFixture, description: 'Account preferences',
    items: [
      { title: 'Profile', href: '/settings/profile' },
      { title: 'Advanced', items: [
        { title: 'Keys', href: '/settings/apikeys' },
        { title: 'Member guide', href: 'https://help.example.test/member', external: true, authorizeOnly: ['user', 'admin'] },
        { title: 'Secret admin link', href: '/admin/private', authorizeOnly: ['admin'] },
      ] },
      { title: 'Empty protected group', items: [{ title: 'Hidden member', href: '/admin/hidden', authorizeOnly: ['admin'] }] },
    ],
  },
  { title: 'Administration', authorizeOnly: ['admin'], items: [{ title: 'Manage users', href: '/admin/users' }] },
];
async function renderSidebar(items: MenuItemConfig[], role = 'user', pathname = '/settings/profile') {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: pathname, component: () => createElement(SidebarNavigation, { items, role, pathname, label: 'Workspace navigation' }) });
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe('the public sidebar configuration renders nested, role-filtered navigation', () => {
  it('renders no-href groups, deep children, descriptions, custom icons and safe external links', async () => {
    overwriteServerAsyncLocalStorage(storage);
    await storage.run({ locale: 'en' }, async () => {
      const html = await renderSidebar(nestedItems);
      expect(html).toContain('Workspace settings');
      expect(html).toContain('Account preferences');
      expect(html).toContain('Advanced');
      expect(html).toContain('href="/settings/apikeys"');
      expect(html).toContain('data-icon="custom"');
      expect(html).toContain('<details class="sidebar-group" open="">');
      expect(html).toContain('<summary>');
      expect(html).toContain('aria-current="page"');
      expect(html).toContain('href="https://help.example.test/member"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).not.toContain('Secret admin link');
      expect(html).not.toContain('Empty protected group');
      expect(html).not.toContain('Administration');
      expect(html).not.toContain('Manage users');
    });
  });
  it('filters roles at every level, retaining admin groups only for administrators', () => {
    overwriteServerAsyncLocalStorage(storage);
    storage.run({ locale: 'en' }, () => {
      expect(JSON.stringify(visibleSidebarItems(nestedItems, 'admin'))).toContain('Manage users');
      expect(JSON.stringify(visibleSidebarItems(nestedItems, 'admin'))).toContain('Secret admin link');
      expect(JSON.stringify(visibleSidebarItems(nestedItems))).not.toContain('Member guide');
      expect(nestedItems[1].items).toHaveLength(3);
    });
  });
  it('opens the localized active branch without changing the shared menu definition', async () => {
    overwriteServerAsyncLocalStorage(storage);
    await storage.run({ locale: 'zh' }, async () => {
      const html = await renderSidebar(nestedItems);
      expect(html).toContain('<details class="sidebar-group" open="">');
      expect(nestedItems[1]).not.toHaveProperty('open');
    });
  });
  it.each(['javascript:alert(1)', 'data:text/html,unsafe', '//outside.example.test', '/\\outside.example.test', 'https://user:password@outside.example.test', 'https://', ' /settings/profile', '/settings/\nprofile'])('rejects unsafe destinations: %s', (href) => {
    overwriteServerAsyncLocalStorage(storage);
    storage.run({ locale: 'en' }, () => {
      expect(sidebarHref(href)).toBeUndefined();
      expect(visibleSidebarItems([{ title: 'Unsafe', href }], 'user')).toEqual([]);
    });
  });
  it('keeps valid children visible when a parent destination is unsafe', async () => {
    overwriteServerAsyncLocalStorage(storage);
    await storage.run({ locale: 'en' }, async () => {
      const html = await renderSidebar([{ title: 'Safe group', href: 'javascript:alert(1)', items: [{ title: 'Profile', href: '/settings/profile' }] }]);
      expect(html).toContain('Safe group');
      expect(html).toContain('href="/settings/profile"');
      expect(html).not.toContain('javascript:');
    });
  });
});
