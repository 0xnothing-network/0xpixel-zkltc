import { useQuery, useQueryClient } from "@tanstack/react-query";

interface UseContractQueryOptions<T> {
  queryKey: string[];
  queryFn: () => Promise<T>;
  staleTime?: number;
  gcTime?: number;
  refetchOnWindowFocus?: boolean;
}

export function useContractQuery<T>({
  queryKey,
  queryFn,
  staleTime = 30_000,
  gcTime = 300_000,
  refetchOnWindowFocus = false,
}: UseContractQueryOptions<T>) {
  return useQuery({
    queryKey,
    queryFn,
    staleTime,
    gcTime,
    refetchOnWindowFocus,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 5000),
  });
}

export function useInvalidateQuery() {
  const queryClient = useQueryClient();
  return (queryKey: string[]) => queryClient.invalidateQueries({ queryKey });
}

export function usePrefetchQuery() {
  const queryClient = useQueryClient();
  return <T>(queryKey: string[], queryFn: () => Promise<T>) => {
    queryClient.prefetchQuery({
      queryKey,
      queryFn,
      staleTime: 60_000,
    });
  };
}
