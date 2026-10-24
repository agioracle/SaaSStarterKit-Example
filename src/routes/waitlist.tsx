import { createFileRoute } from '@tanstack/react-router';
import { WaitlistPage } from '../components/pages/information';
import { seo } from '../lib/seo';
export const Route = createFileRoute('/waitlist')({
  head: () => seo('/waitlist', { title: 'Stay in the loop' }),
  component: WaitlistPage,
});
