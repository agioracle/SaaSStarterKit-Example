import { ToastProvider } from '../components/shared/toaster';
import { websiteConfig } from '../config/website';
import { themeInitialization } from '../components/layout/theme-script';
import { m } from '../locale/paraglide/messages';
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from '@tanstack/react-router';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { isSensitivePath } from '../components/analytics/privacy';
import { Analytics } from '../components/analytics/analytics';
import { CrispChat } from '../components/chatbox/crisp-chat';
import { Header, Footer } from '../components/layout/shell';
import { RouteError } from '../components/layout/route-error';
import { getLocale, localePath } from '../locale';
import stylesheet from '../styles.css?url';
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    scripts: [{ children: themeInitialization(websiteConfig.theme.default) }],
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
    links: [
      { rel: 'stylesheet', href: stylesheet },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ],
  }),
  component: Root,
  notFoundComponent: () => (
    <div className="container error-page">
      <span className="eyebrow">404</span>
      <h1>{m.routes_root_this_page_took_a_different_path()}</h1>
      <p>{m.routes_root_the_address_may_have_changed_or_the()}</p>
      <a className="button primary" href={localePath('/')}>
        {m.routes_root_back_to_home()}
      </a>
    </div>
  ),
  errorComponent: RouteError,
  shellComponent: Document,
});
function Root() {
  const { queryClient } = Route.useRouteContext();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const privatePage =
    path.startsWith('/settings') || path.startsWith('/dashboard') || path.startsWith('/admin');
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <a className="skip-link" href="#main-content">
          {m.routes_root_skip_to_content()}
        </a>
        <Header />
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        {!privatePage && <Footer />}
        {!isSensitivePath(path) && (
          <>
            <Analytics />
            <CrispChat />
          </>
        )}
      </ToastProvider>
    </QueryClientProvider>
  );
}
function Document({ children }: { children: ReactNode }) {
  return (
    <html lang={getLocale()} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
