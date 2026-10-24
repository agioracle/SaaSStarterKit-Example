import { createMiddleware } from '@tanstack/react-start';
import { paraglideMiddleware } from './paraglide/server';
export const localeMiddleware = createMiddleware().server(async ({ request, next }) => {
  // Keep the original request: TanStack's router rewrite handles URL de-localization.
  return paraglideMiddleware(request, async () => (await next()).response);
});
