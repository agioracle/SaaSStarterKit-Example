import { createFileRoute } from '@tanstack/react-router';
import { ProfilePage } from '../components/settings/account';
export const Route = createFileRoute('/_app/settings/profile')({ component: ProfilePage });
