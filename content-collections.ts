import { localeSettings } from './src/config/locale-settings';
import type { Locale } from './src/locale';
import { defineCollection, defineConfig } from '@content-collections/core';
import { z } from 'zod';
export function getLocaleSlug(path: string) {
  const clean = path.replace(/\.md$/, '');
  const suffix = clean.split('.').pop() || '';
  const locale = localeSettings.locales.includes(suffix) ? suffix : localeSettings.baseLocale;
  return {
    locale: locale as Locale,
    slug: localeSettings.locales.includes(suffix) ? clean.slice(0, -suffix.length - 1) : clean,
  };
}
const common = {
  title: z.string(),
  description: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: z.string(),
  published: z.boolean().default(true),
};
const blogSchema = z.object({
  ...common,
  category: z.string(),
  image: z.string().min(1),
  // Declare real intrinsic dimensions and optional same-aspect-ratio variants.
  // Unknown remote dimensions are not guessed; the cover container still reserves space.
  imageWidth: z.number().int().positive().optional(),
  imageHeight: z.number().int().positive().optional(),
  imageVariants: z.array(z.object({ src: z.string().min(1), width: z.number().int().positive() })).optional(),
});
const blog = defineCollection({
  name: 'blog',
  directory: 'content/blog',
  include: '**/*.md',
  schema: blogSchema,
  // This is a publication boundary, not a UI filter. Never serialize drafts into
  // generated modules, including in development or source-map-enabled builds.
  transform: (document, context) =>
    document.published
      ? { ...document, ...getLocaleSlug(document._meta.path) }
      : context.skip(),
});
const blogSummary = defineCollection({
  name: 'blogSummary',
  directory: 'content/blog',
  include: '**/*.md',
  schema: blogSchema,
  transform: (document, context) => {
    if (!document.published) return context.skip();
    // Lists, pagination, locale discovery and SEO need metadata, not every body.
    const { content: _content, ...summary } = document;
    return { ...summary, ...getLocaleSlug(document._meta.path) };
  },
});
const page = defineCollection({
  name: 'page',
  directory: 'content/pages',
  include: '**/*.md',
  schema: z.object(common),
  transform: (document, context) =>
    document.published
      ? { ...document, ...getLocaleSlug(document._meta.path) }
      : context.skip(),
});
const changelog = defineCollection({
  name: 'changelog',
  directory: 'content/changelog',
  include: '**/*.md',
  schema: z.object({ ...common, version: z.string() }),
  transform: (document, context) =>
    document.published
      ? { ...document, ...getLocaleSlug(document._meta.path) }
      : context.skip(),
});
export default defineConfig({ content: [blog, blogSummary, page, changelog] });
