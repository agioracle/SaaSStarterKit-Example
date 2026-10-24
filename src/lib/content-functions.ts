import { createServerFn } from '@tanstack/react-start';
import { isLocale, type Locale } from '../locale';
import { websiteConfig } from '../config/website';
import { parseBlogSearch } from './blog-listing';

function localeInput(locale: unknown): Locale {
  if (!isLocale(locale)) throw new Error('Unsupported content locale');
  return locale;
}
function slugInput(slug: unknown): string {
  if (typeof slug !== 'string' || !slug || slug.length > 200)
    throw new Error('Invalid content slug');
  return slug;
}

/** Server functions are the only browser-callable content boundary. They return
 * published, requested payloads; importing this module never imports Markdown data. */
export const getBlogListing = createServerFn({ method: 'GET' })
  .validator((data: { page: number; category: string; locale: Locale }) => ({ ...parseBlogSearch(data), locale: localeInput(data.locale) }))
  .handler(async ({ data }) => {
    if (!websiteConfig.blog.enabled) return null;
    const { queryBlogListing } = await import('./content-queries.server');
    return queryBlogListing(data, data.locale);
  });
export const getBlogArticle = createServerFn({ method: 'GET' })
  .validator((data: { slug: string; locale: Locale }) => ({ slug: slugInput(data.slug), locale: localeInput(data.locale) }))
  .handler(async ({ data }) => {
    if (!websiteConfig.blog.enabled) return null;
    const { queryBlogArticle } = await import('./content-queries.server');
    return queryBlogArticle(data.slug, data.locale);
  });
export const getLegalDocument = createServerFn({ method: 'GET' })
  .validator((data: { slug: 'privacy' | 'terms' | 'cookie'; locale: Locale }) => {
    if (!['privacy', 'terms', 'cookie'].includes(data.slug)) throw new Error('Unknown legal route');
    return { slug: data.slug, locale: localeInput(data.locale) };
  })
  .handler(async ({ data }) => {
    const { queryLegalPage } = await import('./content-queries.server');
    return queryLegalPage(data.slug, data.locale);
  });
export const getChangelog = createServerFn({ method: 'GET' })
  .validator((data: { locale: Locale }) => ({ locale: localeInput(data.locale) }))
  .handler(async ({ data }) => {
    const { queryChangelog } = await import('./content-queries.server');
    return queryChangelog(data.locale);
  });
