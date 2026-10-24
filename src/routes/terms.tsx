import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { LegalPage } from '../components/pages/content';
import { getLegalDocument } from '../lib/content-functions';
import { seo } from '../lib/seo';
import { getLocale, localePath } from '../locale';
export const Route = createFileRoute('/terms')({
  loader: async () => {
    const locale = getLocale();
    const result = await getLegalDocument({ data: { slug: 'terms', locale } });
    if (!result) throw notFound();
    if (result.page.locale !== locale)
      throw redirect({ href: localePath('/terms', result.page.locale) });
    return result;
  },
  head: ({ loaderData }) => loaderData ? seo('/terms', {
    title: loaderData.page.title,
    description: loaderData.page.description,
    alternateLocales: loaderData.alternateLocales,
  }) : {},
  component: () => <LegalPage {...Route.useLoaderData()} />,
});
