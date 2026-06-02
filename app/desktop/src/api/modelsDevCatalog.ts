import { useQuery } from '@tanstack/react-query';
import { normalizeModelIdForLookup, type ModelDisplayNameMap } from '@/utils/modelDisplay';

export const MODELS_DEV_API_URL = 'https://models.dev/api.json';

interface ModelsDevModel {
  id?: string;
  name?: string;
}

interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>;
}

type ModelsDevResponse = Record<string, ModelsDevProvider>;

export function buildModelsDevDisplayNameMap(raw: unknown): ModelDisplayNameMap {
  const providers = raw && typeof raw === 'object' ? raw as ModelsDevResponse : {};
  const names: ModelDisplayNameMap = {};
  for (const provider of Object.values(providers)) {
    const models = provider?.models;
    if (!models || typeof models !== 'object') continue;
    for (const [modelId, model] of Object.entries(models)) {
      const displayName = typeof model?.name === 'string' ? model.name.trim() : '';
      if (!displayName) continue;
      const keys = [modelId, model?.id]
        .map((value) => normalizeModelIdForLookup(value))
        .filter(Boolean);
      for (const key of keys) {
        names[key] = displayName;
      }
    }
  }
  return names;
}

export async function fetchModelsDevDisplayNames(): Promise<ModelDisplayNameMap> {
  const res = await fetch(MODELS_DEV_API_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`models.dev request failed: ${res.status}`);
  }
  return buildModelsDevDisplayNameMap(await res.json());
}

export function useModelsDevDisplayNames(enabled = true) {
  return useQuery<ModelDisplayNameMap>({
    queryKey: ['modelsDevDisplayNames'],
    queryFn: fetchModelsDevDisplayNames,
    enabled,
    staleTime: 12 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
}
