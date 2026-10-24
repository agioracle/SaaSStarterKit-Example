import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ToastProvider,
  ToastViewport,
  scheduleToastDismiss,
  toastDuration,
  toastReducer,
  useToast,
  type ToastMessage,
} from '../src/components/shared/toaster';
import { getLocale } from '../src/locale';
import { overwriteGetLocale } from '../src/locale/paraglide/runtime';
const originalLocale = getLocale;
afterEach(() => {
  vi.useRealTimers();
  overwriteGetLocale(originalLocale);
});
const toast = (id: string, duration = 5000): ToastMessage => ({
  id,
  title: `Saved ${id}`,
  kind: 'success',
  duration,
});
function Probe() {
  const api = useToast();
  return createElement('span', null, typeof api.toast, typeof api.dismiss, typeof api.dismissAll);
}

describe('local toast queue', () => {
  it('adds, replaces, dismisses, and clears messages', () => {
    let state = toastReducer([], { type: 'add', toast: toast('a') });
    state = toastReducer(state, { type: 'add', toast: { ...toast('a'), title: 'Updated' } });
    expect(state).toHaveLength(1);
    expect(state[0].title).toBe('Updated');
    expect(toastReducer(state, { type: 'dismiss', id: 'unknown' })).toEqual(state);
    expect(toastReducer(state, { type: 'dismiss', id: 'a' })).toEqual([]);
    expect(toastReducer(state, { type: 'clear' })).toEqual([]);
  });
  it('bounds the queue to five notices', () => {
    let state: ToastMessage[] = [];
    for (let index = 0; index < 8; index++)
      state = toastReducer(state, { type: 'add', toast: toast(String(index)) });
    expect(state.map((item) => item.id)).toEqual(['3', '4', '5', '6', '7']);
  });
  it('normalizes finite lifetimes and supports explicitly persistent notices', () => {
    expect(toastDuration({ title: 'Info' })).toBe(5000);
    expect(toastDuration({ title: 'Error', kind: 'error' })).toBe(9000);
    expect(toastDuration({ title: 'Persistent', duration: 0 })).toBe(0);
    expect(toastDuration({ title: 'Short', duration: 5 })).toBe(1000);
    expect(toastDuration({ title: 'Long', duration: 1e8 })).toBe(60000);
    expect(toastDuration({ title: 'Invalid', duration: Number.NaN })).toBe(5000);
  });
  it('automatically dismisses after the lifetime and cleans timers on cancellation', () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    scheduleToastDismiss(toast('first'), dismiss);
    const cancel = scheduleToastDismiss(toast('canceled'), dismiss);
    cancel();
    scheduleToastDismiss(toast('persistent', 0), dismiss);
    vi.advanceTimersByTime(4999);
    expect(dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledExactlyOnceWith('first');
    vi.runAllTimers();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
describe('accessible rendering and app integration', () => {
  it('renders separate polite and assertive live regions with explicit dismiss buttons', () => {
    overwriteGetLocale(() => 'en');
    const html = renderToStaticMarkup(
      createElement(ToastViewport, {
        messages: [toast('ok'), { ...toast('bad'), kind: 'error', title: 'Failed' }],
        dismiss: () => {},
      }),
    );
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('role="alert" aria-live="assertive"');
    expect(html.match(/type="button"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Dismiss notification"');
  });
  it('escapes arbitrary notice text rather than rendering HTML', () => {
    const html = renderToStaticMarkup(
      createElement(ToastViewport, {
        messages: [
          {
            ...toast('safe'),
            title: '<script>bad()</script>',
            description: '<img src=x onerror=bad()>',
          },
        ],
        dismiss: () => {},
      }),
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });
  it('renders localized labels and empty independent server-side queues', () => {
    overwriteGetLocale(() => 'zh');
    const html = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement('span', null, 'Page')),
    );
    expect(html).toContain('aria-label="通知"');
    expect(html).not.toContain('<article');
    expect(
      renderToStaticMarkup(createElement(ToastProvider, null, 'Second request')),
    ).not.toContain('Saved');
  });
  it('requires a provider and exposes a usable API inside it', () => {
    expect(() => renderToStaticMarkup(createElement(Probe))).toThrow('inside ToastProvider');
    expect(
      renderToStaticMarkup(createElement(ToastProvider, null, createElement(Probe))),
    ).toContain('functionfunctionfunction');
  });
  it('mounts once at root and uses fixed clipboard feedback, never secret-bearing toast data', () => {
    const root = readFileSync(new URL('../src/routes/__root.tsx', import.meta.url), 'utf8');
    const keys = readFileSync(
      new URL('../src/components/settings/api-keys.tsx', import.meta.url),
      'utf8',
    );
    expect(root.match(/<ToastProvider>/g)).toHaveLength(1);
    expect(keys).toMatch(
      /await navigator\.clipboard\.writeText\(revealed\);\s*setCopied\(true\);\s*toast\(/,
    );
    const calls = keys.match(/toast\(\{[\s\S]*?\}\)/g) || [];
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => !/revealed|\.key\b|token/.test(call))).toBe(true);
  });
});
