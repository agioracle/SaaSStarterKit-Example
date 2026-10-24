import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baseLocale, getLocale, getLocaleName, isLocale, localeConfig, localePath,
  localeSettings, locales, localizeUrl, deLocalizeUrl, LOCALIZED_PATHS,
} from '../src/lib/locale';
import { createLocaleUrlPatterns } from '../src/config/locale-settings';
import { LocaleSwitch } from '../src/components/layout/shell';
import { LocaleSwitcher } from '../src/components/layout/locale-switcher';
import { isSensitivePath } from '../src/components/analytics/privacy';
import { seo } from '../src/lib/seo';
import { Route as SitemapRoute } from '../src/routes/sitemap[.]xml';
import { overwriteGetLocale, getServerAsyncLocalStorage, overwriteServerAsyncLocalStorage } from '../src/locale/paraglide/runtime';
import { paraglideMiddleware } from '../src/locale/paraglide/server';

vi.mock('../src/auth/client', () => ({ authClient: { useSession: () => ({ data: null }) } }));

const root = fileURLToPath(new URL('..', import.meta.url));
const source = (path: string) => readFileSync(join(root, path), 'utf8');
const originalGetLocale = getLocale;
const originalConfigs = structuredClone(localeConfig);
const originalPaths = [...LOCALIZED_PATHS];
const originalInventory = [...localeSettings.locales];
const originalStorage = getServerAsyncLocalStorage();
const sitemap = async () => {
  const handler = SitemapRoute.options.server?.handlers as { GET: () => Response };
  return handler.GET().text();
};
beforeEach(() => overwriteGetLocale(() => 'en'));
afterEach(() => {
  vi.unstubAllGlobals();
  overwriteGetLocale(originalGetLocale);
  overwriteServerAsyncLocalStorage(originalStorage);
  for (const locale of Object.keys(localeConfig)) delete localeConfig[locale];
  Object.assign(localeConfig, structuredClone(originalConfigs));
  LOCALIZED_PATHS.clear();
  for (const path of originalPaths) LOCALIZED_PATHS.add(path);
  localeSettings.locales.splice(0, localeSettings.locales.length, ...originalInventory);
});

describe('canonical public locale customization', () => {
  it('defines editable configuration at the documented path, not a facade to another owner', () => {
    expect(source('src/lib/locale.ts')).toMatch(/export const localeConfig\b/);
    expect(source('src/lib/locale.ts')).toMatch(/export const LOCALIZED_PATHS\b/);
    expect(source('src/config/locale-settings.ts')).not.toMatch(/export const localeConfig\b/);
    expect(source('src/components/layout/locale-switcher.tsx')).toMatch(/import[^;]*localeConfig[^;]*from ["']\.\.\/\.\.\/lib\/locale["']/);
    expect(LocaleSwitch).toBe(LocaleSwitcher);
    expect(source('src/components/layout/shell.tsx')).toContain('<LocaleSwitch />');
    expect(source('src/lib/seo.ts')).toMatch(/import[^;]*localeConfig[^;]*from ["']\.\/locale["']/);
  });

  it('feeds replacement public names, flags and language tags into the real switcher and SEO', () => {
    localeConfig.en = { name: 'Custom <English>', flag: '🏴‍☠️', hreflang: 'en-GB' };
    localeConfig.zh = { name: '定制中文', flag: '🌐', hreflang: 'zh-Hans' };
    const markup = renderToStaticMarkup(createElement(LocaleSwitch));
    expect(markup).toContain('🏴‍☠️ Custom &lt;English&gt;');
    expect(markup).toContain('🌐 定制中文');
    expect(getLocaleName('en')).toBe('Custom <English>');
    expect(markup.match(/<option\b/g)).toHaveLength(locales.length);
    const head = seo('/about', {});
    expect(head.meta).toContainEqual({ property: 'og:locale', content: 'en_GB' });
    expect(head.links).toContainEqual(expect.objectContaining({ hrefLang: 'en-GB' }));
    expect(head.links).toContainEqual(expect.objectContaining({ hrefLang: 'zh-Hans' }));
  });

  it('allows optional flags and provides native names for a configured locale without a display override', () => {
    localeConfig.en = { name: 'Flagless English', hreflang: 'en' };
    const markup = renderToStaticMarkup(createElement(LocaleSwitch));
    expect(markup).toContain('>Flagless English</option>');
    expect(markup).not.toContain('undefined');
    expect(getLocaleName('fr')).toBeTruthy();
    expect(getLocaleName('not_a_locale')).toBe('not_a_locale');
  });

  it('preserves documented runtime URL helpers, locale prefixes and full navigation state', () => {
    expect(baseLocale).toBe('en');
    expect(isLocale('zh')).toBe(true);
    expect(isLocale('unknown')).toBe(false);
    expect(localePath('/about?from=menu#details', 'en')).toBe('/about?from=menu#details');
    expect(localePath('/about?from=menu#details', 'zh')).toBe('/zh/about?from=menu#details');
    expect(localizeUrl('https://example.test/about?from=menu#details', { locale: 'zh' }).href)
      .toBe('https://example.test/zh/about?from=menu#details');
    expect(deLocalizeUrl('https://example.test/zh/about?from=menu#details').href)
      .toBe('https://example.test/about?from=menu#details');
  });

  it('runs actual switcher navigation without losing the path, query or anchor', () => {
    const browser = { location: { href: 'https://example.test/blog?page=2#articles' } };
    vi.stubGlobal('window', browser);
    const select = LocaleSwitcher();
    const change = select.props.onChange as (event: { target: { value: string } }) => void;
    change({ target: { value: 'zh' } });
    expect(browser.location.href).toBe('https://example.test/zh/blog?page=2#articles');
    change({ target: { value: 'unsupported' } });
    expect(browser.location.href).toBe('https://example.test/zh/blog?page=2#articles');
    change({ target: { value: 'en' } });
    expect(browser.location.href).toBe('https://example.test/blog?page=2#articles');
  });
});

describe('public static translation inventory', () => {
  it('does not invent translations for unknown routes, but follows public registry edits in SEO and sitemap', async () => {
    const path = '/configured-translation-fixture';
    expect(seo(path, {}).links).toHaveLength(1);
    expect(await sitemap()).not.toContain(path);
    LOCALIZED_PATHS.add(path);
    const head = seo(path, {});
    expect(head.links.filter((link) => link.rel === 'alternate')).toHaveLength(locales.length + 1);
    const xml = await sitemap();
    expect(xml).toContain(`${path}</loc>`);
    expect(xml).toContain(`/zh${path}</loc>`);
    LOCALIZED_PATHS.delete(path);
    expect(seo(path, {}).links).toHaveLength(1);
    expect(await sitemap()).not.toContain(path);
  });

  it('normalizes locale prefixes, trailing slashes and queries for static inventory lookup', () => {
    for (const path of ['/about', '/zh/about/', '/blog?page=2']) {
      const head = seo(path, {});
      expect(head.links.filter((link) => link.rel === 'alternate')).toHaveLength(locales.length + 1);
    }
  });

  it('respects sparse content translations and points x-default at an available version', () => {
    const head = seo('/blog/chinese-only', { canonicalLocale: 'zh', alternateLocales: ['zh'] });
    expect(head.links).toHaveLength(3);
    expect(head.links.every((link) => new URL(link.href).pathname === '/zh/blog/chinese-only')).toBe(true);
    expect(head.links).toContainEqual(expect.objectContaining({ hrefLang: 'x-default' }));
    expect(head.links).not.toContainEqual(expect.objectContaining({ hrefLang: localeConfig.en.hreflang }));
    expect(seo('/about', { alternateLocales: [] }).links).toHaveLength(1);
    expect(seo('/blog/base-only', { alternateLocales: ['en', 'en'] }).links).toHaveLength(3);
  });

  it.each(['/auth/login', '/zh/settings/apikeys', '/admin/users', '/dashboard', '/api/auth'])
    ('never publishes private route %s as alternate or sitemap entry, even when misconfigured', async (path) => {
      LOCALIZED_PATHS.add(path);
      const head = seo(path, { alternateLocales: ['en', 'zh'] });
      expect(head.links).toHaveLength(1);
      expect(head.meta).toContainEqual({ name: 'robots', content: 'noindex, nofollow' });
      expect(head.scripts).toEqual([]);
      expect(await sitemap()).not.toContain(`${path}</loc>`);
    });
});

describe('clean build boundary and locale request isolation', () => {
  it('loads the exact build-time module before any generated runtime exists', () => {
    const directory = mkdtempSync(join(tmpdir(), 'locale-contract-'));
    try {
      mkdirSync(join(directory, 'src/config'), { recursive: true });
      mkdirSync(join(directory, 'project.inlang'));
      writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
      copyFileSync(join(root, 'src/config/locale-settings.ts'), join(directory, 'src/config/locale-settings.ts'));
      copyFileSync(join(root, 'project.inlang/settings.json'), join(directory, 'project.inlang/settings.json'));
      const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
        `const { localeSettings, localeUrlPatterns } = await import(${JSON.stringify(pathToFileURL(join(directory, 'src/config/locale-settings.ts')).href)}); console.log(JSON.stringify({ localeSettings, localeUrlPatterns }));`,
      ], { cwd: root, encoding: 'utf8' });
      expect(JSON.parse(output)).toMatchObject({ localeSettings: { baseLocale: 'en', locales: ['en', 'zh'] } });
      expect(existsSync(join(directory, 'src/locale/paraglide'))).toBe(false);
      for (const file of ['vite.config.ts', 'scripts/locale.ts', 'scripts/check-i18n.ts', 'content-collections.ts']) {
        expect(source(file)).toMatch(/from ['"][^'"]*config\/locale-settings['"]/);
        expect(source(file)).not.toMatch(/from ['"][^'"]*lib\/locale['"]/);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps arbitrary configured prefixes ahead of the base catch-all and preserves sensitive-path privacy', () => {
    localeSettings.locales.push('fr');
    expect(createLocaleUrlPatterns()[0].localized).toEqual([
      ['zh', '/zh/:path(.*)?'], ['fr', '/fr/:path(.*)?'], ['en', '/:path(.*)?'],
    ]);
    expect(isSensitivePath('/fr/auth/reset-password')).toBe(true);
    expect(isSensitivePath('/fr/settings/apikeys')).toBe(true);
    expect(isSensitivePath('/fr/blog')).toBe(false);
  });

  it('retains independent middleware locales during overlapping requests', async () => {
    overwriteGetLocale(originalGetLocale);
    let arrived = 0;
    let release = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const responses = await Promise.all((['en', 'zh'] as const).map((locale) =>
      paraglideMiddleware(new Request(`https://example.test${locale === 'zh' ? '/zh' : ''}/about`), async () => {
        const before = getLocale();
        if (++arrived === 2) release();
        await barrier;
        const head = seo('/about', {});
        return Response.json({ before, after: getLocale(), path: localePath('/about'), og: head.meta.find((tag) => 'property' in tag && tag.property === 'og:locale') });
      }),
    ));
    expect(await responses[0].json()).toMatchObject({ before: 'en', after: 'en', path: '/about', og: { content: 'en_US' } });
    expect(await responses[1].json()).toMatchObject({ before: 'zh', after: 'zh', path: '/zh/about', og: { content: 'zh_CN' } });
  });
});
