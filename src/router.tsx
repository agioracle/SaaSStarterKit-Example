import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { deLocalizeUrl, localizeUrl } from './locale';
export function getRouter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createRouter({
    context: { queryClient },
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    rewrite: {
      input: ({ url }) => deLocalizeUrl(url),
      output: ({ url }) => localizeUrl(url),
    },
  });
}
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
