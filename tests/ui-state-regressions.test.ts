import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, type AnyRouter } from '@tanstack/react-router';

// Controlled component hooks, with real Router and QueryClient underneath.
// These run actual handlers/effects and markup in Node. They do not certify browser hydration/focus.
const harness = vi.hoisted(() => ({
  state: [] as unknown[], cursor: 0,
  effect: undefined as undefined | (() => undefined | (() => void)),
  api: vi.fn(), resource: vi.fn(), updateUser: vi.fn(),
  router: undefined as unknown as AnyRouter,
  queryClient: undefined as unknown as QueryClient,
  routeContext: () => ({ session: { user: { id: 'owner', name: 'Before', email: 'owner@example.test', emailVerified: true, image: '' } } }),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.state)) harness.state[index] = typeof initial === 'function' ? initial() : initial;
    return [harness.state[index], (next: unknown) => {
      harness.state[index] = typeof next === 'function' ? next(harness.state[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.state)) harness.state[index] = { current: initial };
    return harness.state[index];
  },
  useEffect: (effect: () => undefined | (() => void)) => { harness.effect = effect; },
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => harness.queryClient,
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useRouter: () => harness.router,
}));
vi.mock('../src/routes/_app', () => ({ Route: { useRouteContext: () => harness.routeContext() } }));
vi.mock('../src/auth/client', () => ({ authClient: { updateUser: harness.updateUser, useSession: () => ({ data: null }) } }));
vi.mock('../src/components/auth/auth-form', () => ({ VerificationResend: () => null }));
vi.mock('../src/components/ui/primitives', async (original) => ({
  ...(await original<typeof import('../src/components/ui/primitives')>()),
  api: harness.api,
  useResource: harness.resource,
}));
import { PaymentStatusPage, BillingPage } from '../src/components/settings/billing';
import { FilesPage } from '../src/components/settings/files';
import { ProfilePage } from '../src/components/settings/account';
import { UsersPage } from '../src/components/admin/users';
import { RouteError } from '../src/components/layout/route-error';
import { queryKeys } from '../src/lib/query-keys';
import { getLocale } from '../src/locale';
import { overwriteGetLocale } from '../src/locale/paraglide/runtime';
import type { PaymentCheckoutStatus } from '../src/payment/types';

const originalLocale = getLocale;
function render<T>(component: () => T): T { harness.cursor = 0; return component(); }
function markup(component: () => ReactNode) { return renderToStaticMarkup(render(component)); }
function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  return Children.toArray(node).flatMap((child) => isValidElement<Record<string, any>>(child)
    ? [child, ...elements(child.props.children)] : []);
}
function find(node: ReactNode, predicate: (props: Record<string, any>, type: unknown) => boolean) {
  const value = elements(node).find((element) => predicate(element.props, element.type));
  if (!value) throw new Error('Control not found in actual component output');
  return value.props;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function status(reference: string, changes: Partial<PaymentCheckoutStatus> = {}): PaymentCheckoutStatus {
  return { reference, provider: 'stripe', state: 'active', hasAccess: true, paid: true,
    planId: 'custom-paid', cancelAtPeriodEnd: false, lifecycle: 'completed', reconciliationRequired: false,
    canCancel: false, canManage: false, canReconcile: false, ...changes };
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => {
  harness.state = []; harness.cursor = 0; harness.effect = undefined;
  harness.api.mockReset(); harness.resource.mockReset(); harness.updateUser.mockReset();
  harness.queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  harness.routeContext = () => ({ session: { user: { id: 'owner', name: 'Before', email: 'owner@example.test', emailVerified: true, image: '' } } });
  overwriteGetLocale(() => 'en');
});
afterEach(() => { harness.queryClient.clear(); overwriteGetLocale(originalLocale); });

describe('payment reference-local component state', () => {
  it('hides A success before B effect/response, then shows only B failure', async () => {
    harness.api.mockResolvedValueOnce(status('A'));
    markup(() => PaymentStatusPage({ reference: 'A' }));
    const cleanupA = harness.effect?.(); await settle();
    expect(markup(() => PaymentStatusPage({ reference: 'A' }))).toContain('Payment confirmed');
    const next = deferred<PaymentCheckoutStatus>(); harness.api.mockReturnValueOnce(next.promise);
    expect(markup(() => PaymentStatusPage({ reference: 'B' }))).not.toContain('Payment confirmed');
    if (cleanupA) cleanupA(); const cleanupB = harness.effect?.();
    expect(markup(() => PaymentStatusPage({ reference: 'B' }))).toContain('Waiting for confirmation');
    next.reject(new Error('B not found')); await settle();
    expect(markup(() => PaymentStatusPage({ reference: 'B' }))).toContain('B not found');
    expect(markup(() => PaymentStatusPage({ reference: 'B' }))).not.toContain('Payment confirmed');
    // History back does not borrow B error, either; it must check A again.
    expect(markup(() => PaymentStatusPage({ reference: 'A' }))).not.toContain('B not found');
    if (cleanupB) cleanupB();
  });

  it('accepts a provider session alias resolved to the server canonical checkout reference', async () => {
    harness.api.mockResolvedValueOnce(status('canonical-checkout'));
    markup(() => PaymentStatusPage({ reference: 'cs_return_session', provider: 'stripe' }));
    const cleanup = harness.effect?.(); await settle();
    expect(markup(() => PaymentStatusPage({ reference: 'cs_return_session', provider: 'stripe' }))).toContain('Payment confirmed');
    expect(markup(() => PaymentStatusPage({ reference: 'another-session', provider: 'stripe' }))).not.toContain('Payment confirmed');
    if (cleanup) cleanup();
  });

  it('aborts/ignores late old responses and treats provider changes as a new identity', async () => {
    const old = deferred<PaymentCheckoutStatus>(); harness.api.mockReturnValueOnce(old.promise);
    markup(() => PaymentStatusPage({ reference: 'same', provider: 'stripe' }));
    const cleanupOld = harness.effect?.();
    const signal = harness.api.mock.calls[0][1].signal as AbortSignal;
    if (cleanupOld) cleanupOld();
    expect(signal.aborted).toBe(true);
    harness.api.mockResolvedValueOnce(status('same', { provider: 'creem', hasAccess: false, paid: false, state: 'pending', lifecycle: 'failed' }));
    markup(() => PaymentStatusPage({ reference: 'same', provider: 'creem' }));
    const cleanupNew = harness.effect?.(); await settle();
    old.resolve(status('same')); await settle();
    const html = markup(() => PaymentStatusPage({ reference: 'same', provider: 'creem' }));
    expect(html).toContain('Checkout failed');
    expect(html).not.toContain('Payment confirmed');
    expect(harness.api).toHaveBeenLastCalledWith('/api/payments?reference=same&provider=creem', expect.any(Object));
    if (cleanupNew) cleanupNew();
  });

  it('rejects a mismatched provider and never infers paid access from lifecycle alone', async () => {
    harness.api.mockResolvedValueOnce(status('requested', { provider: 'creem' }));
    markup(() => PaymentStatusPage({ reference: 'requested', provider: 'stripe' }));
    const cleanup = harness.effect?.(); await settle();
    expect(markup(() => PaymentStatusPage({ reference: 'requested', provider: 'stripe' }))).toContain('did not match this checkout');
    if (cleanup) cleanup();
    harness.api.mockResolvedValueOnce(status('new', { hasAccess: false, paid: false, state: 'pending' }));
    markup(() => PaymentStatusPage({ reference: 'new' }));
    const cleanupNew = harness.effect?.(); await settle();
    expect(markup(() => PaymentStatusPage({ reference: 'new' }))).not.toContain('Payment confirmed');
    if (cleanupNew) cleanupNew();
  });
});

describe('Router retry and session context consistency', () => {
  it('actual Try again reruns the failed loader before resetting the boundary', async () => {
    let calls = 0;
    const root = createRootRoute();
    const page = createRoute({ getParentRoute: () => root, path: '/', loader: () => {
      calls++; if (calls === 1) throw new Error('Temporary session failure'); return 'Recovered';
    } });
    harness.router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ['/'] }) });
    await harness.router.load();
    expect(harness.router.state.matches.at(-1)?.status).toBe('error');
    const reset = vi.fn();
    const tree = render(() => RouteError({ reset, error: new Error('Temporary session failure') }));
    await find(tree, (props) => !!props.onClick).onClick();
    expect(calls).toBe(2);
    expect(harness.router.state.matches.at(-1)?.status).toBe('success');
    expect(harness.router.state.matches.at(-1)?.loaderData).toBe('Recovered');
    expect(reset).toHaveBeenCalledOnce();
  });

  it('profile save refreshes actual beforeLoad session context before showing success', async () => {
    const source = { user: { id: 'owner', name: 'Before', email: 'owner@example.test', emailVerified: true, image: '' } };
    const root = createRootRoute();
    const page = createRoute({ getParentRoute: () => root, path: '/', beforeLoad: () => ({ session: structuredClone(source) }) });
    harness.router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ['/'] }) });
    await harness.router.load();
    harness.routeContext = () => harness.router.state.matches.at(-1)?.context as ReturnType<typeof harness.routeContext>;
    harness.updateUser.mockImplementation(async ({ name }) => { source.user.name = name; return { data: {}, error: null }; });
    let tree = render(ProfilePage);
    find(tree, (props) => props.label === 'Full name').onChange({ target: { value: 'After' } });
    tree = render(ProfilePage);
    await find(tree, (_props, type) => type === 'form').onSubmit({ preventDefault: vi.fn() });
    expect(harness.updateUser).toHaveBeenCalledWith({ name: 'After', image: null });
    expect(harness.routeContext().session.user.name).toBe('After');
    expect(markup(ProfilePage)).toContain('Your profile has been saved.');
  });
});

describe('mutation handlers use domain invalidation', () => {
  it('upload from page two resets to page one and invalidates every cached cursor', async () => {
    const firstKey = queryKeys.fileList('owner', '');
    const secondKey = queryKeys.fileList('owner', 'next');
    harness.queryClient.setQueryData(firstKey, { old: true });
    harness.queryClient.setQueryData(secondKey, { old: true });
    harness.resource.mockReturnValue({ data: { files: [], hasMore: true, nextCursor: 'next' }, loading: false, error: '', reload: vi.fn() });
    harness.api.mockResolvedValue({ id: 'uploaded' });
    let tree = render(FilesPage);
    find(tree, (props) => props.children === 'Next').onClick();
    tree = render(FilesPage);
    find(tree, (props) => props.type === 'file').onChange({ target: { files: [new File(['fixture'], 'fixture.png', { type: 'image/png' })] } });
    await vi.waitFor(() => expect(harness.queryClient.getQueryState(firstKey)?.isInvalidated).toBe(true));
    expect(harness.queryClient.getQueryState(secondKey)?.isInvalidated).toBe(true);
    render(FilesPage);
    expect(harness.resource).toHaveBeenLastCalledWith('/api/files?cursor=', firstKey);
  });

  it('deleting the only row on page two returns to the first page and invalidates all pages', async () => {
    const file = { id: 'last', name: 'last.txt', contentType: 'text/plain', url: '/api/files/last', size: 12, createdAt: '2026-01-01' };
    harness.resource.mockReturnValue({ data: { files: [file], hasMore: true, nextCursor: 'next' }, loading: false, error: '', reload: vi.fn() });
    harness.api.mockResolvedValue({ ok: true });
    harness.queryClient.setQueryData(queryKeys.fileList('owner', ''), { old: true });
    harness.queryClient.setQueryData(queryKeys.fileList('owner', 'next'), { old: true });
    let tree = render(FilesPage);
    find(tree, (props) => props.children === 'Next').onClick();
    tree = render(FilesPage);
    find(tree, (props) => props['aria-label'] === 'Delete last.txt').onClick();
    tree = render(FilesPage);
    await find(tree, (props) => props.variant === 'danger' && !!props.onClick).onClick();
    expect(harness.queryClient.getQueryState(queryKeys.fileList('owner', 'next'))?.isInvalidated).toBe(true);
    render(FilesPage);
    expect(harness.resource).toHaveBeenLastCalledWith('/api/files?cursor=', queryKeys.fileList('owner', ''));
  });
});

it('admin mutation resets pagination and invalidates every saved filter', async () => {
  const user = { id: 'other', name: 'Other user', email: 'other@example.test', emailVerified: true, role: 'user', banned: true, createdAt: '2026-01-01' };
  const active = queryKeys.userList('owner', 'filter=active&page=0');
  const banned = queryKeys.userList('owner', 'filter=banned&page=1');
  harness.queryClient.setQueryData(active, { old: true });
  harness.queryClient.setQueryData(banned, { old: true });
  harness.resource.mockReturnValue({ data: { users: [user], total: 20 }, loading: false, error: '', reload: vi.fn() });
  harness.api.mockResolvedValue({ ok: true });
  let tree = render(UsersPage);
  find(tree, (props) => props.children === 'Next').onClick();
  tree = render(UsersPage);
  find(tree, (props) => props.children === 'Other user').onClick();
  tree = render(UsersPage);
  find(tree, (props) => props.children === 'Unban user').onClick();
  await vi.waitFor(() => expect(harness.queryClient.getQueryState(active)?.isInvalidated).toBe(true));
  expect(harness.queryClient.getQueryState(banned)?.isInvalidated).toBe(true);
  render(UsersPage);
  expect(harness.resource.mock.calls.at(-1)?.[0]).toContain('offset=0');
});

describe('billing uses server authority instead of a paginated checkout heuristic', () => {
  it('shows authoritative plan even when absent from the current history page, and respects capability flags', () => {
    harness.resource.mockReturnValue({ data: {
      entitlement: { plan: { id: 'authoritative-plan' }, provider: 'stripe' }, nextCursor: 'older',
      checkouts: [status('row', { planId: 'wrong-history-plan', canCancel: false, canManage: false })], plans: [],
    }, loading: false, error: '', reload: vi.fn() });
    const html = markup(BillingPage);
    expect(html).toContain('<h2>authoritative-plan</h2>');
    expect(html).not.toContain('Cancel renewal');
    expect(html).not.toContain('Open billing portal');
    expect(html).toContain('provider=stripe');
    let tree = render(BillingPage);
    find(tree, (props) => props.children === 'Next').onClick();
    tree = render(BillingPage);
    expect(tree).toBeDefined();
    expect(harness.resource).toHaveBeenLastCalledWith('/api/payments?limit=20&cursor=older', queryKeys.billingHistory('owner', 'older'));
  });

  it('does not grant a plan based on a stale history row if authoritative entitlement is null', () => {
    harness.resource.mockReturnValue({ data: { entitlement: null, nextCursor: null, checkouts: [status('old')], plans: [] }, loading: false, error: '' });
    expect(markup(BillingPage)).toContain('<h2>Free</h2>');
  });
});

describe('visible localized column labels', () => {
  it('renders actual Chinese column picker labels, not internal object keys', () => {
    overwriteGetLocale(() => 'zh');
    harness.resource.mockReturnValue({ data: { users: [], total: 0 }, loading: false, error: '' });
    let tree = render(UsersPage);
    find(tree, (props) => props.type === 'button' && !!props.onClick).onClick();
    tree = render(UsersPage);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('邮箱');
    expect(html).toContain('角色');
    expect(html).not.toContain('/>created');
    expect(html).not.toContain('/>status');
  });
});


describe('payment completion and resume controls', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('invalidates all billing cursors then replaces the confirmation URL with localized billing', async () => {
    vi.useFakeTimers();
    const replace = vi.fn(); vi.stubGlobal('window', { location: { replace } });
    overwriteGetLocale(() => 'zh');
    const first = queryKeys.billingHistory('owner', '');
    const second = queryKeys.billingHistory('owner', 'next');
    harness.queryClient.setQueryData(first, { stale: true });
    harness.queryClient.setQueryData(second, { stale: true });
    harness.api.mockResolvedValueOnce(status('confirmed'));
    markup(() => PaymentStatusPage({ reference: 'confirmed', provider: 'stripe' }));
    const cleanup = harness.effect?.();
    await vi.advanceTimersByTimeAsync(1199);
    expect(harness.queryClient.getQueryState(first)?.isInvalidated).toBe(true);
    expect(harness.queryClient.getQueryState(second)?.isInvalidated).toBe(true);
    expect(replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(replace).toHaveBeenCalledExactlyOnceWith('/zh/settings/billing');
    if (cleanup) cleanup();
  });
  it('cancels the success redirect when the checkout route is replaced or unmounted', async () => {
    vi.useFakeTimers();
    const replace = vi.fn(); vi.stubGlobal('window', { location: { replace } });
    harness.api.mockResolvedValueOnce(status('old'));
    markup(() => PaymentStatusPage({ reference: 'old' }));
    const cleanup = harness.effect?.();
    await vi.advanceTimersByTimeAsync(10);
    if (cleanup) cleanup();
    await vi.advanceTimersByTimeAsync(2000);
    expect(replace).not.toHaveBeenCalled();
  });
  it('offers Continue payment only after an owned open checkout was freshly reconciled', async () => {
    const assign = vi.fn(); vi.stubGlobal('window', { location: { assign } });
    const pending = status('open', { state: 'pending', hasAccess: false, paid: false, lifecycle: 'open', canReconcile: true });
    harness.resource.mockReturnValue({ data: { entitlement: null, checkouts: [pending], nextCursor: null, plans: [] }, loading: false, error: '' });
    harness.api.mockResolvedValueOnce({ ...pending, checkoutUrl: 'https://checkout.example.test/fresh' });
    let tree = render(BillingPage);
    expect(renderToStaticMarkup(tree)).not.toContain('Continue payment');
    await find(tree, (props) => props.children === 'Refresh with provider').onClick();
    tree = render(BillingPage);
    find(tree, (props) => props.children === 'Continue payment').onClick();
    expect(assign).toHaveBeenCalledExactlyOnceWith('https://checkout.example.test/fresh');
  });
});
