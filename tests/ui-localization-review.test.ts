import { seedBlogPagination } from './fixtures/blog-catalog';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, locales, baseLocale } from '../src/locale';
import { overwriteGetLocale } from '../src/locale/paraglide/runtime';
import { m } from '../src/locale/paraglide/messages';
import {
  createLocaleUrlPatterns,
  localeSettings,
} from '../src/config/locale-settings';
import { getLocaleName } from '../src/lib/locale';
import { getLocaleSlug } from '../content-collections';
import { Calendar } from '../src/components/ui/calendar';
import { calendarDateKey, moveCalendarFocus, utcDate } from '../src/components/ui/calendar-model';
import { Carousel } from '../src/components/ui/carousel';
import { DataTable } from '../src/components/data-table/data-table';
import { BarChart } from '../src/components/dashboard/chart';
import { themeInitialization } from '../src/components/layout/theme-script';
import { isSensitivePath } from '../src/components/analytics/privacy';
import { HeroSection } from '../src/components/blocks/hero';
import { FaqSection } from '../src/components/blocks/faqs';
import { AuthForm } from '../src/components/auth/auth-form';
import { websiteConfig } from '../src/config/website';
import { getPaginatedPosts } from '../src/lib/blog';
import { allPages } from '../.content-collections/generated';
import { Route as SitemapRoute } from '../src/routes/sitemap[.]xml';
import { Route as PrivacyRoute } from '../src/routes/privacy';
import { getPlanLabel } from '../src/config/plan-messages';
vi.mock('../src/auth/client', () => ({ authClient: { useSession: () => ({ data: null }) } }));
const originalLocale = getLocale;
const config = websiteConfig as unknown as {
  auth: { enabled: boolean };
  blog: { pageSize: number };
};
const originalEnabled = config.auth.enabled;
const originalPageSize = config.blog.pageSize;
let restoreContent = () => {};
beforeEach(() => { overwriteGetLocale(() => 'en'); restoreContent = seedBlogPagination(); });
afterEach(() => {
  restoreContent();
  overwriteGetLocale(originalLocale);
  config.auth.enabled = originalEnabled;
  config.blog.pageSize = originalPageSize;
});
const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('catalog and independent landing architecture', () => {
  it('has matching keys and interpolation inputs in every configured catalog', () => {
    const base = JSON.parse(source(`messages/${baseLocale}.json`)) as Record<string, string>;
    expect(Object.keys(base).length).toBeGreaterThan(550);
    for (const locale of locales) {
      const catalog = JSON.parse(source(`messages/${locale}.json`)) as Record<string, string>;
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(base).sort());
      for (const key of Object.keys(base))
        expect((catalog[key].match(/\{\w+\}/g) || []).sort(), `${locale}:${key}`).toEqual(
          (base[key].match(/\{\w+\}/g) || []).sort(),
        );
    }
  });
  it('keeps independent block implementations and a composition-only homepage', () => {
    for (const file of [
      'hero',
      'features',
      'faqs',
      'newsletter-card',
    ]) {
      const text = source(`src/components/blocks/${file}.tsx`);
      expect(text).toMatch(/export function \w+/);
      expect(text).not.toMatch(/from ['"]\.\/homepage/);
    }
    expect(source('src/components/blocks/homepage.tsx')).not.toContain('<section');
    expect(source('src/components/blocks/homepage.tsx')).not.toContain('TestimonialsSection');
    expect(source('examples/landing-page/blocks/testimonials.tsx')).toContain('export function TestimonialsSection');
  });
  it('renders Chinese landing and starter plan copy from the catalog', () => {
    overwriteGetLocale(() => 'zh');
    expect(renderToStaticMarkup(createElement(HeroSection))).toContain(
      m.hero_title().split('\n')[0],
    );
    expect(renderToStaticMarkup(createElement(FaqSection))).toContain('可以免费试用');
    expect(getPlanLabel('Monthly billing')).toBe('按月计费');
    expect(getPlanLabel('Merchant custom copy')).toBe('Merchant custom copy');
  });
  it('keeps interpolation as safely escaped React text', () => {
    const text = m.settings_files_delete({ value1: '<script>bad()</script>' });
    expect(renderToStaticMarkup(createElement('span', null, text))).toContain('&lt;script&gt;');
  });
});

describe('configured locale inventory', () => {
  it('puts arbitrary locale prefixes before the base catch-all', () => {
    expect(
      createLocaleUrlPatterns({ baseLocale: 'en', locales: ['en', 'zh', 'fr'] })[0].localized,
    ).toEqual([
      ['zh', '/zh/:path(.*)?'],
      ['fr', '/fr/:path(.*)?'],
      ['en', '/:path(.*)?'],
    ]);
    expect(getLocaleName('fr')).toBeTruthy();
  });
  it('uses configured suffixes and keeps private paths private for added locales', () => {
    localeSettings.locales.push('fr');
    try {
      expect(getLocaleSlug('first.fr.md')).toEqual({ locale: 'fr', slug: 'first' });
      expect(isSensitivePath('/fr/auth/reset-password')).toBe(true);
      expect(isSensitivePath('/fr/settings/apikeys')).toBe(true);
      expect(isSensitivePath('/fr/blog')).toBe(false);
    } finally {
      localeSettings.locales.pop();
    }
  });
  it('uses the base locale for unsuffixed content', () =>
    expect(getLocaleSlug('first.md')).toEqual({ locale: baseLocale, slug: 'first' }));
});

describe('Calendar model and deterministic server rendering', () => {
  it('crosses month boundaries and skips disabled days', () => {
    const next = moveCalendarFocus(
      utcDate(2026, 9, 30),
      'ArrowRight',
      (day) => day.getUTCDay() === 0 || day.getUTCDay() === 6,
    );
    expect(next && calendarDateKey(next)).toBe('2026-11-02');
  });
  it('clamps PageDown at the next month end', () =>
    expect(calendarDateKey(moveCalendarFocus(utcDate(2026, 0, 31), 'PageDown') as Date)).toBe(
      '2026-02-28',
    ));
  it('supports week boundaries and no-available-date cases', () => {
    expect(calendarDateKey(moveCalendarFocus(utcDate(2026, 9, 14), 'Home') as Date)).toBe(
      '2026-10-11',
    );
    expect(calendarDateKey(moveCalendarFocus(utcDate(2026, 9, 14), 'End') as Date)).toBe(
      '2026-10-17',
    );
    expect(moveCalendarFocus(utcDate(2026, 9, 14), 'ArrowRight', () => true)).toBeNull();
    expect(moveCalendarFocus(utcDate(2026, 9, 14), 'Enter')).toBeNull();
  });
  it('renders explicit Chinese locale, UTC month and only non-submit buttons', () => {
    const html = renderToStaticMarkup(
      createElement(Calendar, {
        initialMonth: utcDate(2026, 9, 1),
        locale: 'zh',
        disabled: (day) => day.getUTCDate() === 1,
      }),
    );
    expect(html).toContain('2026年10月');
    expect(html).toContain('data-date="2026-10-01" disabled="" tabindex="-1"');
    expect(html.match(/<button\b/g)?.length).toBe(html.match(/type="button"/g)?.length);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  });
  it('defers the changing current date until hydration when no initial month is supplied', () => {
    expect(renderToStaticMarkup(createElement(Calendar))).toContain('aria-busy="true"');
  });
  it('keeps Carousel controls non-submit and honors reduced motion in the implementation', () => {
    const html = renderToStaticMarkup(createElement(Carousel, null, 'A slide'));
    expect(html.match(/type="button"/g)).toHaveLength(2);
    expect(source('src/components/ui/carousel.tsx')).toContain('prefers-reduced-motion: reduce');
  });
});

describe('reusable labels, disabled states and metadata', () => {
  it('localizes generic table and chart labels', () => {
    overwriteGetLocale(() => 'zh');
    const table = renderToStaticMarkup(
      createElement(DataTable, { rows: [] as object[], columns: [], rowKey: () => 'id' }),
    );
    expect(table).toContain('没有匹配记录');
    expect(table).toContain('每页行数');
    expect(renderToStaticMarkup(createElement(BarChart, { data: [], title: 'Demo' }))).toContain(
      '查看图表数据',
    );
  });
  it('does not render an auth form or signup CTA when auth is disabled', () => {
    config.auth.enabled = false;
    const html = renderToStaticMarkup(createElement(AuthForm, { mode: 'register' }));
    expect(html).toContain('Sign-in is unavailable');
    expect(html).not.toContain('<form');
    expect(renderToStaticMarkup(createElement(HeroSection))).not.toContain('href="/auth/register"');
  });
  it.each([0, -1, 1.5, Number.NaN])('guards invalid blog page size %s', (size) => {
    config.blog.pageSize = size;
    const result = getPaginatedPosts(1, 'en');
    expect(result.posts).toHaveLength(6);
    expect(result.totalPages).toBe(2);
  });
  it('uses actual legal frontmatter descriptions in metadata', () => {
    const page = allPages.find((page) => page.slug === 'privacy' && page.locale === 'en');
    const head = (PrivacyRoute.options.head as (context: unknown) => { meta: unknown[] })({ loaderData: { page, alternateLocales: ['en', 'zh'] } });
    expect(head.meta).toContainEqual({
      name: 'description',
      content: allPages.find((page) => page.slug === 'privacy' && page.locale === 'en')
        ?.description,
    });
  });
  it('omits unrouted Markdown page slugs from the sitemap', async () => {
    allPages.push({ ...allPages[0], slug: 'unrouted-test-page' });
    try {
      const handler = SitemapRoute.options.server?.handlers as { GET: () => Response };
      expect(await handler.GET().text()).not.toContain('unrouted-test-page');
    } finally {
      allPages.pop();
    }
  });
});

describe('local prepaint theme initializer', () => {
  it.each([
    ['dark', null, false, 'dark'],
    ['light', 'dark', false, 'dark'],
    ['system', null, true, 'dark'],
    ['light', 'unknown', true, 'light'],
  ])('resolves %s and stored %s', (fallback, saved, prefersDark, expected) => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(themeInitialization(String(fallback)), {
      document,
      localStorage: { getItem: () => saved },
      matchMedia: () => ({ matches: prefersDark }),
    });
    expect(document.documentElement.dataset.theme).toBe(expected);
  });
  it('survives blocked storage without external requests or content execution', () => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(themeInitialization('dark'), {
      document,
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
      },
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(themeInitialization('</script>')).not.toContain('</script>');
  });
});
