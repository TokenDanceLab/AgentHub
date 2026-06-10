import { useQuery } from '@tanstack/react-query';
import {
  fetchModelCatalog,
  fetchCCSwitchStatus,
  fetchCCSwitchProviders,
  type ModelCatalogResponse,
  type CCSwitchStatus,
  type CCSwitchProviderModelMapping,
} from './edgeClient';

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

export function useCCSwitchStatus(enabled = true) {
  return useQuery<CCSwitchStatus>({
    queryKey: ['ccswitch', 'status'],
    queryFn: fetchCCSwitchStatus,
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useCCSwitchProviders(appType?: string, enabled = true) {
  return useQuery<CCSwitchProviderModelMapping[]>({
    queryKey: ['ccswitch', 'providers', appType ?? 'claude'],
    queryFn: () => fetchCCSwitchProviders(appType),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

export type {
  ModelCatalogItem,
  ModelCatalogResponse,
  ModelCatalogSource,
  CCSwitchStatus,
  CCSwitchProviderModelMapping,
} from './edgeClient';
