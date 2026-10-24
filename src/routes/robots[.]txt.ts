import { createFileRoute } from '@tanstack/react-router';
import { websiteConfig } from '../config/website';
import { locales, localePath } from '../locale';
export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: () => {
        const privatePaths = ['/auth/', '/settings/', '/dashboard', '/admin/', '/studio', '/library'];
        const exclusions = locales.flatMap((locale) =>
          privatePaths.map((path) => `Disallow: ${localePath(path, locale)}`),
        );
        return new Response(
          `User-agent: *\nAllow: /\nDisallow: /api/\n${exclusions.join('\n')}\nSitemap: ${new URL('/sitemap.xml', websiteConfig.url).href}\n`,
          { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
        );
      },
    },
  },
});
