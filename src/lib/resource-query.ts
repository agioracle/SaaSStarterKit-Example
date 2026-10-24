import { useQuery, type QueryKey } from '@tanstack/react-query';
import { api, errorMessage } from './api-client';

export function useResource<T>(path: string, queryKey: QueryKey = ['resource', path]) {
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api<T>(path, { signal }),
    retry: false,
    staleTime: 15_000,
  });
  return {
    data: query.data ?? null,
    error: query.error ? errorMessage(query.error) : '',
    loading: query.isPending,
    reload: () => {
      void query.refetch();
    },
  };
}
