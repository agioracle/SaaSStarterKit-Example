import { createFileRoute } from '@tanstack/react-router';
import { ApiKeysPage } from '../components/settings/api-keys';
export const Route = createFileRoute('/_app/settings/apikeys')({ component: ApiKeysPage });
