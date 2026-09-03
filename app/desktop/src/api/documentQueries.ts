// React Query hooks for Hub Server documents.
// Thin wrappers around hubClient methods.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createHubClient, type HubDocumentListItem } from '@/api/hubClient';
import { fetchAllPages } from '@shared/hub/paginate';
import { getAccessToken } from '@/hooks/useAuth';
import type { DocRow } from '@agenthub/workbench/pages';

// Lazy singleton — avoids creating the client on module load when Hub is not needed.
let _hubClient: ReturnType<typeof createHubClient> | null = null;
function getHubClient() {
  if (!_hubClient) _hubClient = createHubClient({ getToken: getAccessToken });
  return _hubClient;
}

// ── Documents ────────────────────────────────────────────────────

export function useDocumentList(
  params?: Parameters<ReturnType<typeof getHubClient>['listDocuments']>[0],
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['hub', 'documents', params],
    // The only caller passes `undefined`, so this was a first-page-only fetch
    // with the cursor dropped (#2290 defect class). Caller-supplied filters
    // (status/source/tag) are preserved and merged under the walk's own
    // pageSize/pageCursor, so the parameterised form keeps working.
    queryFn: () =>
      fetchAllPages((page) => getHubClient().listDocuments({ ...params, ...page })),
    enabled: opts?.enabled ?? false,
  });
}

export function useCreateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<ReturnType<typeof getHubClient>['createDocument']>[0]) =>
      getHubClient().createDocument(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'documents'] });
    },
  });
}

// ── Mapping ──────────────────────────────────────────────────────

type AppTranslate = (key: string, options?: any) => string;

export function hubDocToDocRow(doc: HubDocumentListItem, t?: AppTranslate): DocRow {
  const tag = doc.tag?.trim();
  return {
    id: doc.id,
    title: doc.title?.trim() || t?.('documents.unnamed') || '未命名文档',
    ...(tag ? { tag } : {}),
    location: doc.location?.trim() || t?.('documents.myLibrary') || '我的文档库',
    owner: doc.owner_id?.trim() || 'Hub',
    time: formatDocTime(doc.updated_at ?? doc.created_at, t),
  };
}

function formatDocTime(value: string | undefined, t?: AppTranslate): string {
  if (!value) return 'Hub';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  if (diffDays === 0) {
    return t?.('documents.time.today', { time }) ?? `今天 ${time}`;
  }
  if (diffDays === 1) {
    return t?.('documents.time.yesterday', { time }) ?? `昨天 ${time}`;
  }
  return t?.('documents.time.date', { month: date.getMonth() + 1, day: date.getDate(), time })
    ?? `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}
