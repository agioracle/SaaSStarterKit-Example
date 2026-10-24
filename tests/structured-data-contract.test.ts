import { afterEach, describe, expect, it, vi } from 'vitest';
import * as structuredData from '../src/lib/structured-data';
import { seo } from '../src/lib/seo';
import { blogListingHead } from '../src/lib/blog-seo';

const options = {
  path: '/about',
  siteUrl: 'https://custom.example.test',
  siteName: 'Configured brand',
  title: 'About configured brand',
  description: 'Configured page description',
  canonicalUrl: 'https://custom.example.test/zh/about',
  locale: 'zh',
  logo: '/logo.png',
  socialLinks: ['https://example.com/community', 'https://example.com/community', 'mailto:private@example.com'],
};
afterEach(() => vi.restoreAllMocks());

describe('documented structured-data module is the actual consumer boundary', () => {
  it('returns a TanStack script entry and escapes content that could close its script element', () => {
    const value = { text: '</script><script>alert(1)</script>' };
    const script = structuredData.jsonLdScript(value);
    expect(script.type).toBe('application/ld+json');
    expect(script.children).not.toContain('<');
    expect(JSON.parse(script.children)).toEqual(value);
    expect(structuredData.jsonLd(value)).toBe(script.children);
  });
  it('builds the graph from configured branding and canonical page inputs', () => {
    expect(structuredData.siteEntityIds('https://custom.example.test/')).toEqual(structuredData.siteEntityIds('https://custom.example.test'));
    const graph = structuredData.publicPageGraph(options)['@graph'];
    expect(graph[0]).toMatchObject({ '@type': 'Organization', name: options.siteName, logo: 'https://custom.example.test/logo.png', sameAs: ['https://example.com/community'] });
    expect(graph[1]).toMatchObject({ '@type': 'WebSite', name: options.siteName });
    expect(graph[2]).toMatchObject({ '@type': 'AboutPage', url: options.canonicalUrl, inLanguage: 'zh' });
  });
  it('uses graph customization in this public module when SEO actually renders scripts', () => {
    const original = structuredData.publicPageGraph;
    vi.spyOn(structuredData, 'publicPageGraph').mockImplementation((input) => {
      const graph = original(input);
      return { ...graph, '@graph': graph['@graph'].map((node, index) => index === 2 ? { ...node, name: 'CUSTOM_PUBLIC_GRAPH' } : node) };
    });
    expect(JSON.parse(seo('/about', {}).scripts[0].children)['@graph'][2].name).toBe('CUSTOM_PUBLIC_GRAPH');
  });
  it('uses the public script serializer for both site and appended blog nodes, but not private graphs', () => {
    const serializer = vi.spyOn(structuredData, 'jsonLdScript');
    blogListingHead({ page: 2 });
    expect(serializer.mock.calls.some(([node]) => (node as Record<string, unknown>)['@type'] === 'Blog')).toBe(true);
    expect(serializer.mock.calls.some(([node]) => '@graph' in (node as object))).toBe(true);
    serializer.mockClear();
    expect(seo('/auth/login', {}).scripts).toEqual([]);
    expect(seo('/admin/users', {}).scripts).toEqual([]);
    expect(serializer).not.toHaveBeenCalled();
  });
});
