import { websiteConfig } from '../config/website';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { FilesPage } from '../components/settings/files';
export const Route = createFileRoute('/_app/settings/files')({
  beforeLoad: () => {
    if (!websiteConfig.storage.enabled) throw notFound();
  },
  component: FilesPage,
});
