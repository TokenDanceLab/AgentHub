import { QueryClient } from '@tanstack/react-query';
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 2, gcTime: 5 * 60 * 1000 } },
});
