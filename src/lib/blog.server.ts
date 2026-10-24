import { allBlogs } from "../../.content-collections/generated";
import { getLocale, baseLocale, type Locale } from "../locale";

export type BlogPost = (typeof allBlogs)[number];
import { websiteConfig } from '../config/website';
import { paginatePosts } from './blog-listing';
export { getPostLocales, type BlogSummary } from './blog-catalog.server';

/** Public server-only helpers return full BlogPost records, matching the
 * documented contract. Browser-facing listing functions use blog-catalog.server
 * instead, and serialize only the requested page of body-free summaries. */
export function getSortedPosts(locale: Locale = getLocale()): BlogPost[] {
  return allBlogs.filter((post) => post.locale === locale && post.published)
    .sort((a, b) => b.date.localeCompare(a.date));
}
export function getPaginatedPosts(page: number, locale: Locale = getLocale(), category = '') {
  const posts = getSortedPosts(locale).filter((post) => !category || post.category === category);
  return paginatePosts(posts, page, websiteConfig.blog.pageSize);
}

export function getPostBySlug(slug: string, locale: Locale = getLocale()) {
	const exact = allBlogs.find(
		(post) => post.slug === slug && post.locale === locale && post.published,
	);
	return (
		exact ??
		(locale === baseLocale
			? undefined
			: allBlogs.find(
					(post) =>
						post.slug === slug && post.locale === baseLocale && post.published,
				))
	);
}
