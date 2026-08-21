// React Query hooks for Hub Server documents.
// Thin wrappers around hubClient methods.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createHubClient, type HubDocumentListItem } from '@/api/hubClient';
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
    queryFn: () => getHubClient().listDocuments(params),
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

export function hubDocToDocRow(doc: HubDocumentListItem): DocRow {
  const tag = doc.tag?.trim();
  return {
    id: doc.id,
    title: doc.title?.trim() || '未命名文档',
    ...(tag ? { tag } : {}),
    location: doc.location?.trim() || '我的文档库',
    owner: doc.owner_id?.trim() || 'Hub',
    time: formatDocTime(doc.updated_at ?? doc.created_at),
  };
}

function formatDocTime(value: string | undefined): string {
  if (!value) return 'Hub';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
  if (diffDays === 1) {
    return `昨天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}
