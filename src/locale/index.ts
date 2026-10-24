import {
  getLocale,
  localizeUrl,
  deLocalizeUrl,
  locales,
  baseLocale,
  isLocale,
} from './paraglide/runtime';
export { getLocale, localizeUrl, deLocalizeUrl, locales, baseLocale, isLocale };
export type Locale = (typeof locales)[number];
export function localePath(path: string, locale = getLocale()): string {
  const result = localizeUrl(new URL(path, 'http://local.invalid'), { locale });
  return result.pathname + result.search + result.hash;
}
export function safeReturnPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\r\n]/.test(value)
  )
    return '/dashboard';
  return value;
}
