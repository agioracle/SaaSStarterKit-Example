import { useEffect } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { isSensitivePath } from './privacy';
import { websiteConfig } from '../../config/website';
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  clarity?: ((...args: unknown[]) => void) & { q?: unknown[][] };
};
/** Load only public HTTPS scripts configured by the deploying site owner. Never on the server. */
function appendScript(id: string, source: string, attributes: Record<string, string> = {}) {
  if (document.getElementById(id)) return;
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return;
  }
  if (url.protocol !== 'https:') return;
  const script = document.createElement('script');
  script.id = id;
  script.src = url.href;
  script.async = true;
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  script.onerror = () => {
    script.remove();
  };
  document.head.appendChild(script);
}
export function GoogleAnalytics() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const id = import.meta.env.VITE_GOOGLE_ANALYTICS_ID as string | undefined;
  useEffect(() => {
    if (!path || !import.meta.env.PROD || isSensitivePath(window.location.pathname)) return;
    if (!id || !/^G-[A-Z0-9]+$/.test(id)) return;
    const target = window as AnalyticsWindow;
    target.dataLayer ||= [];
    target.gtag ||= (...args) => {
      target.dataLayer?.push(args);
    };
    if (!document.getElementById('edgekit-google-analytics')) {
      target.gtag('js', new Date());
      target.gtag('config', id, { send_page_view: false });
      appendScript(
        'edgekit-google-analytics',
        `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`,
      );
    }
    target.gtag('event', 'page_view', {
      page_path: window.location.pathname,
      page_location: window.location.origin + window.location.pathname,
    });
  }, [path]);
  return null;
}
export function UmamiAnalytics() {
  useEffect(() => {
    if (!import.meta.env.PROD || isSensitivePath(window.location.pathname)) return;
    const id = import.meta.env.VITE_UMAMI_WEBSITE_ID;
    const source = import.meta.env.VITE_UMAMI_SCRIPT;
    if (id && source) appendScript('edgekit-umami', source, { 'data-website-id': id });
  }, []);
  return null;
}
export function PlausibleAnalytics() {
  useEffect(() => {
    if (!import.meta.env.PROD || isSensitivePath(window.location.pathname)) return;
    const source = import.meta.env.VITE_PLAUSIBLE_SCRIPT;
    if (source)
      appendScript('edgekit-plausible', source, {
        'data-domain': new URL(websiteConfig.url).hostname,
      });
  }, []);
  return null;
}
export function ClarityAnalytics() {
  useEffect(() => {
    if (!import.meta.env.PROD || isSensitivePath(window.location.pathname)) return;
    const id = import.meta.env.VITE_CLARITY_PROJECT_ID;
    if (!id || !/^[a-z0-9]+$/i.test(id)) return;
    const target = window as AnalyticsWindow;
    if (!target.clarity) {
      const queue = ((...args: unknown[]) => {
        queue.q.push(args);
      }) as ((...args: unknown[]) => void) & { q: unknown[][] };
      queue.q = [];
      target.clarity = queue;
    }
    appendScript('edgekit-clarity', `https://www.clarity.ms/tag/${encodeURIComponent(id)}`);
  }, []);
  return null;
}
export function Analytics() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return import.meta.env.PROD && websiteConfig.analytics.enabled && !isSensitivePath(path) ? (
    <>
      <GoogleAnalytics />
      <UmamiAnalytics />
      <PlausibleAnalytics />
      <ClarityAnalytics />
    </>
  ) : null;
}
