import { m } from '../locale/paraglide/messages';

import { websiteConfig } from '../config/website';
import { getLocalizedMetadata } from '../config/metadata';
import { getLocale, localePath, type Locale } from '../locale';
import type { BlogPost } from './blog';
import { seo } from './seo';
import { jsonLdScript, siteEntityIds } from './structured-data';
import { blogListingPath, parseBlogSearch } from './blog-listing';

export function blogListingHead(search: Record<string, unknown> = {}) {
  const locale = getLocale();
  const { page, category } = parseBlogSearch(search);
  const path = blogListingPath(page, category);
  const base = seo(path, { title: 'Journal' });
  // Filter pages remain crawlable but do not compete with unfiltered pagination.
  if (category) base.meta.push({ name: 'robots', content: 'noindex, follow' });
  const url = new URL(localePath(path, locale), websiteConfig.url).href;
  return {
    ...base,
    scripts: [
      ...base.scripts,
      jsonLdScript({
          '@context': 'https://schema.org',
          '@type': 'Blog',
          '@id': `${url}#blog`,
          name: `${getLocalizedMetadata(locale).name} ${m.lib_blog_seo_journal({}, { locale })}`,
          url,
          inLanguage: locale,
          isPartOf: { '@id': siteEntityIds(websiteConfig.url).website },
          publisher: { '@id': siteEntityIds(websiteConfig.url).organization },
        }),
    ],
  };
}

export function blogArticleHead(post: BlogPost, alternateLocales: Locale[]) {
  const path = `/blog/${post.slug}`;
  const base = seo(path, {
    title: post.title,
    description: post.description,
    image: post.image,
    imageWidth: post.imageWidth,
    imageHeight: post.imageHeight,
    type: 'article',
    alternateLocales,
  });
  const url = new URL(localePath(path, post.locale), websiteConfig.url).href;
  const blogUrl = new URL(localePath('/blog', post.locale), websiteConfig.url).href;
  return {
    ...base,
    scripts: [
      ...base.scripts,
      jsonLdScript({
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          '@id': `${url}#article`,
          url,
          headline: post.title,
          description: post.description,
          datePublished: post.date,
          inLanguage: post.locale,
          author: {
            '@type': 'Organization',
            '@id': siteEntityIds(websiteConfig.url).organization,
            name: getLocalizedMetadata(post.locale).name,
          },
          publisher: { '@id': siteEntityIds(websiteConfig.url).organization },
          image: new URL(post.image, websiteConfig.url).href,
          mainEntityOfPage: url,
          isPartOf: { '@type': 'Blog', '@id': `${blogUrl}#blog`, url: blogUrl },
        }),
    ],
  };
}
