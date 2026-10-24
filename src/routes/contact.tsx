import { createFileRoute } from '@tanstack/react-router';
import { ContactPage } from '../components/pages/information';
import { seo } from '../lib/seo';
export const Route = createFileRoute('/contact')({
  head: () => seo('/contact', { title: 'Contact' }),
  component: ContactPage,
});
