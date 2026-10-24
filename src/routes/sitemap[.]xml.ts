import { locales, localePath } from '../locale';
import { LOCALIZED_PATHS } from '../lib/locale';
import { createFileRoute } from '@tanstack/react-router';
import { allBlogs, allPages } from '../../.content-collections/generated';
import { websiteConfig } from '../config/website';
const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ||
      character,
  );
export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: () => {
        const paths = [...LOCALIZED_PATHS].filter((path) => {
          const segments = new URL(path, websiteConfig.url).pathname.split('/');
          if ((locales as readonly string[]).includes(segments[1])) segments.splice(1, 1);
          const routePath = segments.join('/').replace(/\/+$/, '') || '/';
          return !/^\/(?:auth|settings|admin|dashboard|api)(?:\/|$)/.test(routePath)
            && (routePath !== '/waitlist' || websiteConfig.newsletter.enabled)
            && (routePath !== '/pricing' || websiteConfig.payment.enabled)
            && (routePath !== '/blog' || websiteConfig.blog.enabled);
        });
        const urls = paths.flatMap((path) => locales.map((locale) => localePath(path, locale)));
        const routedPages = new Set(['privacy', 'terms', 'cookie']);
        for (const page of allPages.filter((page) => routedPages.has(page.slug)))
          urls.push(localePath(`/${page.slug}`, page.locale));
        if (websiteConfig.blog.enabled)
          for (const post of allBlogs.filter((post) => post.published))
            urls.push(localePath(`/blog/${post.slug}`, post.locale));
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...new Set(urls)].map((path) => `<url><loc>${escapeXml(new URL(path, websiteConfig.url).href)}</loc></url>`).join('')}</urlset>`,
          {
            headers: {
              'Content-Type': 'application/xml; charset=utf-8',
              'Cache-Control': 'public, max-age=300',
            },
          },
        );
      },
    },
  },
});
