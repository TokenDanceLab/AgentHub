// React Query hooks for Hub documents.
// Desktop edition — thin wrappers around getHubClient().

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getHubClient } from '@/api/hubClient';

export interface DocRow {
  id: string;
  title: string;
  ownerName: string;
  updatedAt: string;
}

export function hubDocToDocRow(doc: {
  id: string;
  name?: string;
  title?: string;
  owner_name?: string;
  owner_id?: string;
  updated_at?: string;
  created_at?: string;
}): DocRow {
  return {
    id: doc.id,
    title: doc.name ?? doc.title ?? 'Untitled',
    ownerName: doc.owner_name ?? doc.owner_id ?? '—',
    updatedAt: doc.updated_at ?? doc.created_at ?? '',
  };
}

export function useDocumentList(
  _projectId?: string,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['hub', 'documents'],
    queryFn: () => getHubClient().listDocuments(),
    enabled: opts?.enabled ?? false,
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name?: string; content?: string }) =>
      getHubClient().createDocument(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hub', 'documents'] });
    },
  });
}
