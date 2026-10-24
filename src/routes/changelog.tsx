import { createFileRoute } from '@tanstack/react-router';
import { ChangelogPage } from '../components/pages/content';
import { getChangelog } from '../lib/content-functions';
import { getLocale } from '../locale';
import { seo } from '../lib/seo';
export const Route = createFileRoute('/changelog')({
  loader: () => getChangelog({ data: { locale: getLocale() } }),
  head: () => seo('/changelog', { title: 'Changelog' }),
  component: () => <ChangelogPage releases={Route.useLoaderData()} />,
});
