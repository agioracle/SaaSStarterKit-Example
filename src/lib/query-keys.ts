import type { QueryClient } from '@tanstack/react-query';

/** Domain prefixes invalidate every cached cursor/filter, scoped to the signed-in owner.
 * Authentication boundaries still use a full document navigation, with a new QueryClient.
 */
export const queryKeys = {
  files: (userId: string) => ['files', userId] as const,
  fileList: (userId: string, cursor: string) => ['files', userId, 'list', { cursor }] as const,
  users: (userId: string) => ['admin-users', userId] as const,
  userList: (userId: string, filters: string) => ['admin-users', userId, 'list', filters] as const,
  billing: (userId: string) => ['billing', userId] as const,
  billingHistory: (userId: string, cursor: string) => ['billing', userId, 'history', { cursor }] as const,
};

export function invalidateFiles(client: QueryClient, userId: string) {
  return client.invalidateQueries({ queryKey: queryKeys.files(userId) });
}
export function invalidateUsers(client: QueryClient, userId: string) {
  return client.invalidateQueries({ queryKey: queryKeys.users(userId) });
}
export function invalidateBilling(client: QueryClient, userId: string) {
  return client.invalidateQueries({ queryKey: queryKeys.billing(userId) });
}
