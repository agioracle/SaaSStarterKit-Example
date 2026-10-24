import { createFileRoute } from '@tanstack/react-router';
import { AboutPage } from '../components/pages/information';
import { seo } from '../lib/seo';
export const Route = createFileRoute('/about')({
  head: () => seo('/about', { title: 'About' }),
  component: AboutPage,
});
