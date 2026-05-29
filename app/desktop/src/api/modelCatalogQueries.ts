import { useQuery } from '@tanstack/react-query';
import { fetchModelCatalog, type ModelCatalogResponse } from './edgeClient';

export function useModelCatalog(enabled = true) {
  return useQuery<ModelCatalogResponse>({
    queryKey: ['modelCatalog'],
    queryFn: fetchModelCatalog,
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

export type { ModelCatalogItem, ModelCatalogResponse, ModelCatalogSource } from './edgeClient';
