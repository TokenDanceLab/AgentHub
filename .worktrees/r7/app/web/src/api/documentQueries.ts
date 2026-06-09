import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createHubClient } from './hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import type { HubDocumentListResponse, CreateHubDocumentRequest, UpdateHubDocumentRequest } from './hubClient';

export const documentsQueryKey = ['web-v4', 'hub-documents'] as const;

export function useHubDocuments(options: { enabled?: boolean; getToken?: () => string | null } = {}) {
  const getToken = options.getToken ?? getAccessToken;
  return useQuery<HubDocumentListResponse>({
    queryKey: documentsQueryKey,
    queryFn: async () => {
      const token = getToken();
      if (!token) return { items: [], page: { hasMore: false } };
      const client = createHubClient({ getToken: () => token });
      return client.listDocuments();
    },
    enabled: options.enabled ?? true,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function useCreateHubDocument(options: { getToken?: () => string | null } = {}) {
  const getToken = options.getToken ?? getAccessToken;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateHubDocumentRequest) => {
      const token = getToken();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient({ getToken: () => token });
      return client.createDocument(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });
}

export function useUpdateHubDocument(options: { getToken?: () => string | null } = {}) {
  const getToken = options.getToken ?? getAccessToken;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ documentId, data }: { documentId: string; data: UpdateHubDocumentRequest }) => {
      const token = getToken();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient({ getToken: () => token });
      return client.updateDocument(documentId, data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });
}

export function useDeleteHubDocument(options: { getToken?: () => string | null } = {}) {
  const getToken = options.getToken ?? getAccessToken;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const token = getToken();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient({ getToken: () => token });
      return client.deleteDocument(documentId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });
}
