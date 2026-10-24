import { seedBlogPagination } from './fixtures/blog-catalog';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, type Locale } from '../src/locale';
import { overwriteGetLocale } from '../src/locale/paraglide/runtime';
import { getPaginatedPosts, getSortedPosts } from '../src/lib/blog-catalog';
import { blogListingPath, parseBlogSearch, validateBlogSearch } from '../src/lib/blog-listing';
import type { blogListingHead } from '../src/lib/blog-seo';
import { BlogListing } from '../src/components/blog/blog';
import { Route } from '../src/routes/blog.index';
import { normalizeBlogListing, queryBlogListing } from '../src/lib/content-queries.server';
vi.mock('../src/lib/content-functions', async () => {
  const queries = await import('../src/lib/content-queries.server');
  return { getBlogListing: async ({ data }: { data: { page: number; category: string; locale: Locale } }) => queries.queryBlogListing(data, data.locale) };
});

const originalLocale = getLocale;
let restoreContent = () => {};
beforeEach(() => { overwriteGetLocale(() => 'en'); restoreContent = seedBlogPagination(); });
afterEach(() => { overwriteGetLocale(originalLocale); restoreContent(); });
function head(search: Record<string, unknown>) {
  return (Route.options.head as (context: unknown) => ReturnType<typeof blogListingHead>)({ loaderData: queryBlogListing(search) });
}
function canonical(search: Record<string, unknown>) {
  return new URL(head(search).links.find((link) => link.rel === 'canonical')?.href || '');
}
describe('blog pagination canonical and filter policy', () => {
  it('does not inject default search values that force clean URLs to redirect', () => {
    expect(validateBlogSearch({})).toEqual({});
    expect(validateBlogSearch({ page: 2 })).toEqual({ page: 2 });
  });
  it.each(['en', 'zh'] as Locale[])('makes the distinct %s second page self-canonical', (locale) => {
    overwriteGetLocale(() => locale);
    expect(getPaginatedPosts(1).posts[0].slug).not.toBe(getPaginatedPosts(2).posts[0].slug);
    const url = canonical({ page: 2, category: '' });
    expect(url.pathname).toBe(locale === 'zh' ? '/zh/blog' : '/blog');
    expect(url.search).toBe('?page=2');
    expect(head({ page: 2 }).meta).not.toContainEqual(expect.objectContaining({ name: 'robots' }));
    const html = renderToStaticMarkup(createElement(BlogListing, queryBlogListing({ page: 2 })));
    expect(html).toContain(getPaginatedPosts(2).posts[0].title);
    expect(html).not.toContain('?page=1');
  });

  it.each([undefined, '', 'NaN', 'Infinity', -2, 0, 1, 1.8])('normalizes first/invalid page %s without page=1 in canonical', (page) => {
    expect(canonical({ page }).search).toBe('');
    expect(parseBlogSearch({ page }).page).toBe(1);
  });

  it('normalizes invalid categories and redirects overflow to the real last page', async () => {
    const last = getPaginatedPosts(Number.MAX_SAFE_INTEGER).currentPage;
    expect(normalizeBlogListing({ page: 900, category: 'not-a-category' })).toEqual({ page: last, category: '' });
    expect(canonical({ page: 900 }).search).toBe(`?page=${last}`);
    const loader = Route.options.loader as (context: unknown) => Promise<unknown>;
    await expect(loader({ deps: { page: 900, category: '' } })).rejects.toMatchObject({ options: { href: `/blog?page=${last}`, replace: true } });
  });

  it('uses normalized self-canonical, noindex/follow for category filters and encoded links', () => {
    const category = getSortedPosts()[0].category;
    const result = head({ page: 900, category: ` ${category} ` });
    expect(result.meta).toContainEqual({ name: 'robots', content: 'noindex, follow' });
    const url = new URL(result.links.find((link) => link.rel === 'canonical')?.href || '');
    expect(url.searchParams.get('category')).toBe(category);
    expect(url.searchParams.get('page')).toBeNull();
    expect(blogListingPath(1, 'Design & build')).toBe('/blog?category=Design+%26+build');
  });
});
