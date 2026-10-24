import { readFile } from 'node:fs/promises';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { coverImageProps } from '../src/components/blog/image';
import { PricingSection } from '../src/components/blocks/pricing';
import { seo } from '../src/lib/seo';
import { getSortedPosts, getPaginatedPosts } from '../src/lib/blog';
import { queryBlogListing, queryLegalPage } from '../src/lib/content-queries.server';
import { htmlAssetPaths, assertBundleBudget, PERFORMANCE_BUDGET } from '../scripts/performance-budget';

vi.mock('../src/auth/client', () => ({ authClient: { useSession: () => ({ data: null }) } }));
describe('content delivery and SEO boundaries', () => {
  it('returns full public server-side posts while internal listing queries stay body-free', () => {
    expect(getSortedPosts('en')[0].content.length).toBeGreaterThan(0);
    expect(getPaginatedPosts(1, 'en').posts[0].content).toBe(getSortedPosts('en')[0].content);
    const listing = queryBlogListing({ page: 1 }, 'en');
    expect(listing.posts.length).toBeLessThanOrEqual(6);
    expect(listing.posts.length).toBeGreaterThan(0);
    expect(listing.posts.every((post) => !('content' in post))).toBe(true);
    expect(listing.total).toBeGreaterThanOrEqual(listing.posts.length);
    expect(queryLegalPage('privacy', 'en')?.page.content.length).toBeGreaterThan(0);
  });
  it('does not import generated content or marketing/Markdown barrels from public critical routes', async () => {
    for (const route of ['blog.index', 'blog.$slug', 'privacy', 'terms', 'cookie', 'changelog']) {
      const source = await readFile(`src/routes/${route}.tsx`, 'utf8');
      expect(source).not.toContain('.content-collections');
      expect(source).not.toMatch(/from ['"][^'"]*lib\/blog(?:-catalog)?['"]/);
      expect(source).not.toContain('components/pages/information');
      expect(source).toContain('content-functions');
    }
    const shell = await readFile('src/components/layout/shell.tsx', 'utf8');
    expect(shell).not.toContain('@base-ui/react/menu');
    expect(shell).toContain("import('./shell-menus')");
    const serverBoundary = await readFile('src/lib/content-functions.ts', 'utf8');
    expect(serverBoundary).toContain('createServerFn');
    expect(serverBoundary).toContain("await import('./content-queries.server')");
    expect(await readFile('src/components/pages/information.tsx', 'utf8')).not.toContain('blocks/homepage');
  });
  it('reserves actual dimensions for the bundled raster and accepts safe authored variants', () => {
    expect(coverImageProps({ image: '/og.png' }, '100vw')).toMatchObject({ width: 1200, height: 630, sizes: '100vw', decoding: 'async' });
    expect(coverImageProps({ image: '/og.png' }, '100vw').srcSet).toContain('/og-640.png 640w');
    expect(coverImageProps({ image: '/remote.jpg' }, '100vw').width).toBeUndefined();
    expect(coverImageProps({ image: '/remote.jpg', imageWidth: 800, imageHeight: 600, imageVariants: [{ src: 'javascript:alert(1)', width: 400 }, { src: '/small.jpg', width: 400 }] }, '50vw')).toMatchObject({ width: 800, height: 600, srcSet: '/small.jpg 400w' });
  });
  it('gives the standalone pricing page an H1 while landing blocks keep H2', () => {
    expect(renderToStaticMarkup(createElement(PricingSection as ComponentType<{ headingLevel?: 1 | 2 }>, { headingLevel: 1 }))).toMatch(/<h1>/);
    const block = renderToStaticMarkup(createElement(PricingSection));
    expect(block).not.toMatch(/<h1>/);
    expect(block).toMatch(/<h2>/);
  });
  it('provides explicit raster OG metadata and guards future private route schemas', () => {
    const head = seo('/', { image: '/og.png' });
    expect(head.meta).toContainEqual({ property: 'og:image:width', content: '1200' });
    expect(head.meta).toContainEqual({ property: 'og:image:height', content: '630' });
    expect(head.meta).toContainEqual({ property: 'og:image:type', content: 'image/png' });
    for (const path of ['/auth/new', '/admin/future', '/zh/settings/private', '/api/test']) {
      expect(seo(path, {}).scripts).toEqual([]);
      expect(seo(path, {}).meta).toContainEqual({ name: 'robots', content: 'noindex, nofollow' });
    }
    expect(seo('/about', {}).scripts.length).toBeGreaterThan(0);
  });
  it('measures only deduplicated declared JS and fails excessive budgets', () => {
    expect(htmlAssetPaths('<link rel="modulepreload" href="/assets/index-ABCDEFGH.js"><script src="/assets/index-ABCDEFGH.js"></script><link rel="stylesheet" href="/assets/style-ABCDEFGH.css">')).toEqual(['/assets/index-ABCDEFGH.js']);
    expect(() => assertBundleBudget({ homepageTotals: { raw: PERFORMANCE_BUDGET.homepageJsRaw + 1, gzip9: 0 }, entry: { raw: 0, gzip9: 0 } } as never)).toThrow('homepage raw');
  });
});
