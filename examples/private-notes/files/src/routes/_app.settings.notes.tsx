import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { seo } from '@/lib/seo';
export const Route = createFileRoute('/_app/settings/notes')({
  head: () => seo('/settings/notes', { title: 'Private notes', noIndex: true }),
  component: lazyRouteComponent(() => import('@/features/private-notes/page'), 'PrivateNotesPage'),
});
