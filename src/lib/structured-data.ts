/** Serialize JSON-LD safely inside an HTML script element. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** A complete entry for TanStack head().scripts, including safe serialization. */
export function jsonLdScript(value: unknown) {
  return { type: 'application/ld+json', children: jsonLd(value) };
}

export function siteEntityIds(siteUrl: string) {
  const root = `${siteUrl.replace(/\/$/, '')}/`;
  return { organization: `${root}#organization`, website: `${root}#website` };
}

export interface PublicPageGraphOptions {
  path: string;
  siteUrl: string;
  siteName: string;
  title: string;
  description: string;
  canonicalUrl: string;
  locale: string;
  logo?: string;
  socialLinks?: readonly string[];
}

/** Actual public-page graph implementation. Customize this documented module
 * to change the graph used by seo(), rather than editing a disconnected facade. */
export function publicPageGraph(options: PublicPageGraphOptions) {
  const siteUrl = options.siteUrl.replace(/\/$/, '');
  const { organization: organizationId, website: websiteId } = siteEntityIds(siteUrl);
  const sameAs = [...new Set((options.socialLinks || []).filter((url) => /^https:\/\//.test(url)))];
  const pageType = options.path === '/about' ? 'AboutPage'
    : options.path === '/contact' ? 'ContactPage'
    : options.path === '/blog' ? 'CollectionPage' : 'WebPage';
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: options.siteName,
        url: siteUrl,
        ...(options.logo ? { logo: new URL(options.logo, siteUrl).href } : {}),
        ...(sameAs.length ? { sameAs } : {}),
      },
      { '@type': 'WebSite', '@id': websiteId, name: options.siteName, url: siteUrl },
      {
        '@type': pageType,
        name: options.title,
        description: options.description,
        url: options.canonicalUrl,
        inLanguage: options.locale,
        isPartOf: { '@id': websiteId },
      },
    ],
  };
}
