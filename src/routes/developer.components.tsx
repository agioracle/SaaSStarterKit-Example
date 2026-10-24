import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { seo } from '../lib/seo';
export const Route = createFileRoute('/developer/components')({
  beforeLoad: () => { if (!import.meta.env.DEV) throw notFound(); },
  head: () => seo('/developer/components', { title: 'Component workbench', noIndex: true }),
  // The build-time branch removes the gallery import from production, not just its navigation.
  component: import.meta.env.DEV
    ? lazyRouteComponent(() => import('../components/developer/gallery'), 'ComponentGallery')
    : () => null,
});
