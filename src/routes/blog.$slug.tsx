import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { BlogArticle } from '../components/blog/article';
import { getBlogArticle } from '../lib/content-functions';
import { websiteConfig } from '../config/website';
import { getLocale, localePath } from '../locale';
import { blogArticleHead } from '../lib/blog-seo';
export const Route = createFileRoute('/blog/$slug')({
  loader: async ({ params }) => {
    if (!websiteConfig.blog.enabled) throw notFound();
    const locale = getLocale();
    const result = await getBlogArticle({ data: { slug: params.slug, locale } });
    if (!result) throw notFound();
    if (result.post.locale !== locale)
      throw redirect({ href: localePath(`/blog/${params.slug}`, result.post.locale) });
    return result;
  },
  head: ({ loaderData }) => loaderData ? blogArticleHead(loaderData.post, loaderData.alternateLocales) : {},
  component: () => <BlogArticle post={Route.useLoaderData().post} />,
});
