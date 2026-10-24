import { getAuthCapabilities } from '../auth/functions';
import { createFileRoute } from '@tanstack/react-router';
import { AuthForm } from '../components/auth/auth-form';
import { seo } from '../lib/seo';
export const Route = createFileRoute('/auth/login')({
  loader: () => getAuthCapabilities(),
  validateSearch: (
    search: Record<string, unknown>,
  ): { redirect?: string; token?: string; error?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  head: () => seo('/auth/login', { title: 'Sign in', noIndex: true }),
  component: Page,
});
function Page() {
  const search = Route.useSearch();
  const capabilities = Route.useLoaderData();
  return (
    <AuthForm
      mode="login"
      googleEnabled={capabilities.google}
      redirectTo={search.redirect}
      token={search.token}
      errorCode={search.error}
    />
  );
}
