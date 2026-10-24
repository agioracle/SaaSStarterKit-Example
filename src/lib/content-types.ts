import type { Blog, BlogSummary, Page, Changelog } from '../../.content-collections/generated';
import type { Locale } from '../locale';
export type { BlogSummary };
export type BlogArticleData = { post: Blog; alternateLocales: Locale[] };
export type LegalPageData = { page: Page; alternateLocales: Locale[] };
export type ChangelogData = Changelog[];
export type BlogListingData = {
  page: number;
  category: string;
  categories: string[];
  posts: BlogSummary[];
  currentPage: number;
  totalPages: number;
  total: number;
};
