/** URL-only helpers: no generated content, React, or server imports. */
export type BlogSearch = { page?: unknown; category?: unknown };
export function parseBlogSearch(search: BlogSearch = {}) {
  const page = Number(search.page);
  return {
    page: Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1,
    category: typeof search.category === 'string' ? search.category.trim() : '',
  };
}

/** Do not inject defaults during Router validation. That would redirect /blog
 * to ?page=1&category= before a loader has a chance to normalize the content. */
export function validateBlogSearch(search: Record<string, unknown>): BlogSearch {
  return {
    ...(search.page === undefined ? {} : { page: search.page }),
    ...(search.category === undefined ? {} : { category: search.category }),
  };
}

export function blogListingPath(page = 1, category = '') {
  const search = new URLSearchParams();
  if (page > 1) search.set('page', String(page));
  if (category) search.set('category', category);
  return `/blog${search.size ? `?${search}` : ''}`;
}

export function paginatePosts<T>(posts: readonly T[], page: number, configuredPageSize: number) {
  const pageSize = Number.isInteger(configuredPageSize) && configuredPageSize > 0 ? configuredPageSize : 6;
  const totalPages = Math.max(1, Math.ceil(posts.length / pageSize));
  const currentPage = Math.max(1, Math.min(Number.isFinite(page) ? Math.floor(page) : 1, totalPages));
  return {
    posts: posts.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    totalPages,
    currentPage,
    total: posts.length,
  };
}
