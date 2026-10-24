import generatedSummaries from "../../.content-collections/generated/allBlogSummaries.js";
import type { BlogSummary } from "../../.content-collections/generated";
import { websiteConfig } from "../config/website";
import { getLocale, type Locale } from "../locale";

import { paginatePosts } from './blog-listing';

export type { BlogSummary } from "../../.content-collections/generated";

// The direct metadata import keeps article bodies outside listing dependency graphs.
const allBlogSummaries = generatedSummaries as BlogSummary[];

export function getSortedPosts(locale: Locale = getLocale()) {
	return allBlogSummaries
		.filter((post) => post.locale === locale && post.published)
		.sort((a, b) => b.date.localeCompare(a.date));
}

export function getPostLocales(slug: string): Locale[] {
	return allBlogSummaries
		.filter((post) => post.slug === slug && post.published)
		.map((post) => post.locale);
}

export function getPaginatedPosts(
	page: number,
	locale: Locale = getLocale(),
	category = "",
) {
	const sorted = getSortedPosts(locale).filter(
		(post) => !category || post.category === category,
	);
	return paginatePosts(sorted, page, websiteConfig.blog.pageSize);
}
