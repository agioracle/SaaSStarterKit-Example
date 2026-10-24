import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { Header, Footer } from '../src/components/layout/shell';

vi.mock('../src/auth/client', () => ({ authClient: { useSession: () => ({ data: null }) } }));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => '/',
  Link: ({ to, children }: { to: string; children: ReactNode }) => createElement('a', { href: to }, children),
}));
vi.mock('../src/config/navbar-config', () => ({ getNavbarLinks: () => [
  { title: 'Public config navigation', href: '/about' },
  { title: 'Hidden administrator item', href: '/admin/users', authorizeOnly: ['admin'] },
] }));
vi.mock('../src/config/footer-config', () => ({ getFooterLinks: () => [
  { title: 'Public config footer', items: [{ title: 'Custom footer destination', href: '/roadmap' }] },
] }));
vi.mock('../src/config/social-config', () => ({ getSocialLinks: () => [
  { title: 'Custom social destination', href: 'https://example.com/community', external: true },
] }));
describe('documented public navigation customization', () => {
  it('renders navbar-config entries and honors role visibility', () => {
    const html = renderToStaticMarkup(createElement(Header));
    expect(html).toContain('Public config navigation');
    expect(html).toContain('href="/about"');
    expect(html).not.toContain('Hidden administrator item');
  });
  it('renders footer-config and social-config entries', () => {
    const html = renderToStaticMarkup(createElement(Footer));
    expect(html).toContain('Public config footer');
    expect(html).toContain('Custom footer destination');
    expect(html).toContain('href="/roadmap"');
    expect(html).toContain('Custom social destination');
    expect(html).toContain('href="https://example.com/community"');
  });
  it('loads avatar-config in the optional menu without moving it into anonymous shell', async () => {
    const menus = await readFile('src/components/layout/shell-menus.tsx', 'utf8');
    expect(menus).toContain("from '../../config/avatar-config'");
    expect(menus).toContain('visibleTo(item, user.role');
    expect(menus).toContain('MenuIcon icon={item.icon}');
  });
});
