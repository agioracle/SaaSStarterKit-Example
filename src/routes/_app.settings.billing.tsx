import { createFileRoute } from '@tanstack/react-router';
import { BillingPage } from '../components/settings/billing';
export const Route = createFileRoute('/_app/settings/billing')({ component: BillingPage });
