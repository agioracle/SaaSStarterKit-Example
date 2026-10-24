import { createFileRoute, notFound } from '@tanstack/react-router';
import { NotificationsPage } from '../components/settings/account';
import { websiteConfig } from '../config/website';
export const Route = createFileRoute('/_app/settings/notifications')({
  beforeLoad: () => {
    if (!websiteConfig.newsletter.enabled) throw notFound();
  },
  component: NotificationsPage,
});
