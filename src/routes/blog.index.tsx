import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { BlogListing } from '../components/blog/listing';
import { websiteConfig } from '../config/website';
import { blogListingHead } from '../lib/blog-seo';
import { blogListingPath, parseBlogSearch, validateBlogSearch } from '../lib/blog-listing';
import { getBlogListing } from '../lib/content-functions';
import { getLocale, localePath } from '../locale';
export const Route = createFileRoute('/blog/')({
  beforeLoad: () => { if (!websiteConfig.blog.enabled) throw notFound(); },
  validateSearch: validateBlogSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const result = await getBlogListing({ data: { ...parseBlogSearch(deps), locale: getLocale() } });
    if (!result) throw notFound();
    const parsed = parseBlogSearch(deps);
    if (result.page !== parsed.page || result.category !== parsed.category) {
      throw redirect({ href: localePath(blogListingPath(result.page, result.category)), replace: true });
    }
    return result;
  },
  head: ({ loaderData }) => blogListingHead(loaderData),
  component: () => <BlogListing {...Route.useLoaderData()} />,
});
