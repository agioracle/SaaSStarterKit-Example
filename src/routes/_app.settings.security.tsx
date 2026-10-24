import { createFileRoute } from '@tanstack/react-router';
import { SecurityPage } from '../components/settings/account';
export const Route = createFileRoute('/_app/settings/security')({ component: SecurityPage });
