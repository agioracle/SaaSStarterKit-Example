import { AsyncLocalStorage } from 'node:async_hooks';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalizedMetadata } from '../src/config/metadata';
import { websiteConfig } from '../src/config/website';
import { Brand, Footer } from '../src/components/layout/shell';
import { seo } from '../src/lib/seo';
import { getLocale, type Locale } from '../src/locale';
import { getServerAsyncLocalStorage, overwriteServerAsyncLocalStorage } from '../src/locale/paraglide/runtime';
import { m } from '../src/locale/paraglide/messages';
import en from '../messages/en.json';
import zh from '../messages/zh.json';

vi.mock('../src/auth/client', () => ({ authClient: { useSession: () => ({ data: null }) } }));
const originalDescriptors = Object.getOwnPropertyDescriptors(websiteConfig.metadata);
const originalStorage = getServerAsyncLocalStorage();
const storage = new AsyncLocalStorage<{ locale?: Locale; origin?: string; messageCalls?: Set<string> }>();
afterEach(() => {
  Object.defineProperties(websiteConfig.metadata, originalDescriptors);
  overwriteServerAsyncLocalStorage(originalStorage);
});
function configure(values: Record<'name' | 'title' | 'description', PropertyDescriptor>) {
  Object.defineProperties(websiteConfig.metadata, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { configurable: true, enumerable: true, ...value }])));
}

describe('canonical metadata customization reaches actual SEO and branding', () => {
  it('honors public string fields throughout SEO, JSON-LD, brand, and footer', () => {
    overwriteServerAsyncLocalStorage(storage);
    configure({ name: { value: 'Northstar' }, title: { value: 'Northstar workspace' }, description: { value: 'A configured description.' } });
    storage.run({ locale: 'zh' }, () => {
      const head = seo('/', {});
      expect(head.meta).toContainEqual({ title: 'Northstar workspace' });
      expect(head.meta).toContainEqual({ name: 'description', content: 'A configured description.' });
      expect(head.meta).toContainEqual({ property: 'og:site_name', content: 'Northstar' });
      expect(head.meta).toContainEqual({ property: 'og:description', content: 'A configured description.' });
      expect(JSON.parse(head.scripts[0].children)['@graph'][0].name).toBe('Northstar');
      expect(seo('/about', { title: 'About' }).meta[0]).toEqual({ title: `${zh.lib_seo_about} · Northstar` });
      expect(renderToStaticMarkup(createElement(Brand))).toContain('Northstar');
      const footer = renderToStaticMarkup(createElement(Footer));
      expect(footer.match(/Northstar/g)).toHaveLength(2);
      expect(websiteConfig.name).toBe('Northstar');
    });
  });

  it('keeps custom translated getters and simultaneous English/Chinese SSR isolated', async () => {
    overwriteServerAsyncLocalStorage(storage);
    configure({
      name: { get() { return `Northstar ${getLocale()}`; } },
      title: { get() { return `Custom ${m.site_title()}`; } },
      description: { get() { return `Custom ${m.site_description()}`; } },
    });
    const results = await Promise.all((['en', 'zh', 'en', 'zh'] as const).map((locale, index) => storage.run({ locale, origin: `https://${locale}.example.test`, messageCalls: new Set() }, async () => {
      await new Promise((resolve) => setTimeout(resolve, index % 2 ? 0 : 3));
      const opposite = locale === 'en' ? 'zh' : 'en';
      expect(getLocalizedMetadata(opposite).name).toBe(`Northstar ${opposite}`);
      expect(getLocale()).toBe(locale);
      expect(storage.getStore()?.origin).toBe(`https://${locale}.example.test`);
      const messages = locale === 'zh' ? zh : en;
      const head = seo('/', {});
      const brand = renderToStaticMarkup(createElement(Brand));
      expect(head.meta).toContainEqual({ title: `Custom ${messages.site_title}` });
      expect(head.meta).toContainEqual({ name: 'description', content: `Custom ${messages.site_description}` });
      expect(brand).toContain(`Northstar ${locale}`);
      expect(websiteConfig.name).toBe(`Northstar ${locale}`);
      return { head, brand };
    })));
    expect(results).toHaveLength(4);
    expect(storage.getStore()).toBeUndefined();
  });

  it('resolves localized defaults with explicit locale even without an ambient request', () => {
    overwriteServerAsyncLocalStorage(undefined);
    expect(getLocalizedMetadata('zh').description).toBe(zh.site_description);
    expect(getLocalizedMetadata('en').description).toBe(en.site_description);
    expect(getLocalizedMetadata('zh').title).toBe(zh.site_title);
  });

  it('supports explicit-locale function values without ambient locale mutation', () => {
    overwriteServerAsyncLocalStorage(undefined);
    configure({
      name: { value: (locale: Locale) => `Workspace ${locale}` },
      title: { value: (locale: Locale) => m.site_title({}, { locale }) },
      description: { value: (locale: Locale) => m.site_description({}, { locale }) },
    });
    expect(getLocalizedMetadata('zh')).toMatchObject({ name: 'Workspace zh', title: zh.site_title, description: zh.site_description });
    expect(getLocalizedMetadata('en')).toMatchObject({ name: 'Workspace en', title: en.site_title, description: en.site_description });
  });

  it('preserves the outer request after a failing custom getter', () => {
    overwriteServerAsyncLocalStorage(storage);
    configure({ name: { value: 'Fixture' }, title: { get() { throw new Error('Invalid customization'); } }, description: { value: 'Fixture' } });
    storage.run({ locale: 'en' }, () => {
      expect(() => getLocalizedMetadata('zh')).toThrow('Invalid customization');
      expect(getLocale()).toBe('en');
    });
  });
});
