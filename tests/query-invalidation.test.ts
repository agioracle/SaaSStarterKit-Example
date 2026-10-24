import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { invalidateBilling, invalidateFiles, invalidateUsers, queryKeys } from '../src/lib/query-keys';

describe('domain mutation cache consistency (real QueryClient/QueryObserver)', () => {
  it.each([
    ['files', (page: string) => queryKeys.fileList('owner', page), invalidateFiles],
    ['users', (page: string) => queryKeys.userList('owner', `filter=active&page=${page}`), invalidateUsers],
    ['billing', (page: string) => queryKeys.billingHistory('owner', page), invalidateBilling],
  ] as const)('%s invalidates fresh inactive pages, then fetches current data on return', async (_domain, key, invalidate) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000, gcTime: 0 } } });
    let version = 1;
    const first = vi.fn(async () => ({ version, items: ['first'] }));
    const second = vi.fn(async () => ({ version, items: ['last'] }));
    // Keep inactive entries cached so this reproduces the original fresh-cache race.
    client.setQueryDefaults(key('1'), { gcTime: 60_000 });
    client.setQueryDefaults(key('2'), { gcTime: 60_000 });
    const observer = new QueryObserver(client, { queryKey: key('1'), queryFn: first });
    const stop = observer.subscribe(() => {});
    try {
      await observer.refetch();
      observer.setOptions({ queryKey: key('2'), queryFn: second });
      await observer.refetch();
      expect(first).toHaveBeenCalledTimes(1);
      version = 2; // A successful upload/delete/role/cancel changes the server.
      await invalidate(client, 'owner');
      expect(client.getQueryState(key('1'))?.isInvalidated).toBe(true);
      observer.setOptions({ queryKey: key('1'), queryFn: first });
      await vi.waitFor(() => expect(observer.getCurrentResult().data?.version).toBe(2));
      expect(first).toHaveBeenCalledTimes(2);
      expect(client.getQueryData(key('2'))).toMatchObject({ version: 2 });
    } finally {
      stop();
      client.clear();
    }
  });

  it('invalidates all admin filters without invalidating another owner or resource domain', async () => {
    const client = new QueryClient();
    const active = queryKeys.userList('admin', 'role=user&page=0');
    const banned = queryKeys.userList('admin', 'banned=true&page=2');
    const other = queryKeys.userList('other-admin', 'banned=true&page=2');
    const files = queryKeys.fileList('admin', '');
    for (const key of [active, banned, other, files]) client.setQueryData(key, { total: 1 });
    await invalidateUsers(client, 'admin');
    expect(client.getQueryState(active)?.isInvalidated).toBe(true);
    expect(client.getQueryState(banned)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    expect(client.getQueryState(files)?.isInvalidated).toBe(false);
    client.clear();
  });
});
