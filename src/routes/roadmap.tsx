import { createFileRoute } from '@tanstack/react-router';
import { RoadmapPage } from '../components/pages/information';
import { seo } from '../lib/seo';
export const Route = createFileRoute('/roadmap')({
  head: () => seo('/roadmap', { title: 'Roadmap' }),
  component: RoadmapPage,
});
