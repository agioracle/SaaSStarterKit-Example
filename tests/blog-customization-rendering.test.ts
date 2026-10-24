import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from '../src/routes/blog.index';
import { queryBlogListing } from '../src/lib/content-queries.server';

const customization = vi.hoisted(() => ({ module: '' }));
vi.mock('../src/components/blog/blog-card', async (original) => {
  const actual = await original<typeof import('../src/components/blog/blog-card')>();
  const { createElement } = await import('react');
  return { ...actual, BlogCard: (props: Parameters<typeof actual.BlogCard>[0]) =>
    customization.module === 'card'
      ? createElement('div', { 'data-public-card-customization': true }, props.post.title)
      : createElement(actual.BlogCard, props) };
});
vi.mock('../src/components/blog/blog-grid', async (original) => {
  const actual = await original<typeof import('../src/components/blog/blog-grid')>();
  const { createElement } = await import('react');
  return { ...actual, BlogGrid: (props: Parameters<typeof actual.BlogGrid>[0]) =>
    customization.module === 'grid'
      ? createElement('section', { 'data-public-grid-customization': true }, `${props.posts.length} custom cards`)
      : createElement(actual.BlogGrid, props) };
});
vi.mock('../src/components/blog/blog-pagination', async (original) => {
  const actual = await original<typeof import('../src/components/blog/blog-pagination')>();
  const { createElement } = await import('react');
  return { ...actual, BlogPagination: (props: Parameters<typeof actual.BlogPagination>[0]) =>
    customization.module === 'pagination'
      ? createElement('nav', { 'data-public-pagination-customization': true }, `Custom page ${props.currentPage}`)
      : createElement(actual.BlogPagination, props) };
});
afterEach(() => { customization.module = ''; vi.restoreAllMocks(); });

function renderBlogRoute() {
  const data = queryBlogListing({ page: 1 }, 'en');
  vi.spyOn(Route, 'useLoaderData').mockReturnValue(data);
  return renderToStaticMarkup(createElement(Route.options.component as ComponentType));
}

describe('documented blog customization files drive the actual route', () => {
  it('renders the real card, grid, and pagination by default', () => {
    const html = renderBlogRoute();
    expect(html).toContain('class="blog-card"');
    expect(html).toContain('class="blog-grid"');
    expect(html).toContain('class="pagination"');
  });
  it.each(['card', 'grid', 'pagination'])('uses a replacement from the public blog-%s module in the route render', (module) => {
    customization.module = module;
    const html = renderBlogRoute();
    expect(html).toContain(`data-public-${module}-customization="true"`);
    expect(html).toContain('journal-page');
  });
});
