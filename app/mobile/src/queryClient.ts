import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Persister } from "@tanstack/react-query-persist-client";

/**
 * Mobile QueryClient with offline-first persistence.
 *
 * - Queries use `networkMode: 'offlineFirst'` so cached data is served
 *   immediately when offline instead of erroring.
 * - The full query cache is persisted to localStorage via
 *   @tanstack/react-query-persist-client, so thread lists, messages, and
 *   other data survive page reloads and offline sessions.
 * - Mutations still use `networkMode: 'online'` (default) because failed
 *   sends are handled by the offline message queue (offlineQueue.ts).
 */

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
      // Serve cached data while offline; refetch when connectivity returns.
      networkMode: "offlineFirst",
    },
  },
});

/**
 * localStorage-backed persister for React Query cache.
 *
 * Uses the official sync-storage persister from the persist-client plugin.
 * The cache key AGENTHUB_MOBILE_QUERY_CACHE stores:
 *  - Last-fetched thread list
 *  - Last-fetched messages per thread
 *  - Run list and other query results
 *
 * This makes the app functional immediately on cold start while offline.
 */
export const persister: Persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "AGENTHUB_MOBILE_QUERY_CACHE",
  // Throttle writes to avoid excessive serialization during rapid updates.
  throttleTime: 1000,
});
