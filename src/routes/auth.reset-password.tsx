import { createFileRoute } from '@tanstack/react-router';
import { AuthForm } from '../components/auth/auth-form';
import { seo } from '../lib/seo';
export const Route = createFileRoute('/auth/reset-password')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { redirect?: string; token?: string; error?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  head: () => seo('/auth/reset-password', { title: 'Choose a new password', noIndex: true }),
  component: Page,
});
function Page() {
  const search = Route.useSearch();
  return (
    <AuthForm
      mode="reset"
      redirectTo={search.redirect}
      token={search.token}
      errorCode={search.error}
    />
  );
}
