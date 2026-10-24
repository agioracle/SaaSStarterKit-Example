import { allPages, allChangelogs } from '../../.content-collections/generated';
import { getPostBySlug } from './blog.server';
import { getPaginatedPosts, getPostLocales, getSortedPosts } from './blog-catalog.server';
import { parseBlogSearch, type BlogSearch } from './blog-listing';
import { baseLocale, getLocale, type Locale } from '../locale';
import type { BlogListingData } from './content-types';

export function normalizeBlogListing(search: BlogSearch = {}, locale: Locale = getLocale()) {
  const parsed = parseBlogSearch(search);
  const categories = new Set(getSortedPosts(locale).map((post) => post.category));
  const category = categories.has(parsed.category) ? parsed.category : '';
  const { currentPage } = getPaginatedPosts(parsed.page, locale, category);
  return { page: currentPage, category };
}

/** Only the requested page is serialized. The catalog and all bodies stay server-side. */
export function queryBlogListing(search: BlogSearch = {}, locale: Locale = getLocale()): BlogListingData {
  const { page, category } = normalizeBlogListing(search, locale);
  return {
    ...getPaginatedPosts(page, locale, category),
    page,
    category,
    categories: [...new Set(getSortedPosts(locale).map((post) => post.category))],
  };
}
export function queryBlogArticle(slug: string, locale: Locale) {
  const post = getPostBySlug(slug, locale);
  return post ? { post, alternateLocales: getPostLocales(slug) } : null;
}
export function getLegalPage(slug: string, locale: Locale = getLocale()) {
  return allPages.find((page) => page.slug === slug && page.locale === locale && page.published);
}
export function queryLegalPage(slug: string, locale: Locale) {
  const page = getLegalPage(slug, locale) ?? getLegalPage(slug, baseLocale);
  return page ? {
    page,
    alternateLocales: allPages.filter((item) => item.slug === slug && item.published).map((item) => item.locale),
  } : null;
}
export function queryChangelog(locale: Locale) {
  return allChangelogs.filter((item) => item.locale === locale && item.published)
    .sort((a, b) => b.date.localeCompare(a.date));
}
