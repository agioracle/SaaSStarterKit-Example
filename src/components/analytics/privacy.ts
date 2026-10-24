import { localeSettings } from '../../config/locale-settings';
/** Never load optional third-party telemetry/chat around credentials, private data, or text-input workflows. */
export function isSensitivePath(pathname: string): boolean {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const segments = path.split('/');
  if (localeSettings.locales.includes(segments[1])) segments.splice(1, 1);
  return /^\/(?:auth|settings|admin|dashboard|ai|contact|waitlist)(?:\/|$)/.test(
    segments.join('/'),
  );
}
