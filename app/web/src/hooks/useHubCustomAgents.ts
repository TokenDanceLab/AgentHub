import { useEffect, useState } from 'react';
import { getHubBaseUrl } from './useHubSession';

export type HubCustomAgent = {
  id: string;
  owner_user_id?: string;
  name: string;
  avatar_url?: string;
  agent_type: string;
  system_prompt: string;
  capability_tags?: string;
  tool_whitelist?: string;
  model_params?: string;
  created_at?: string;
  updated_at?: string;
};

type HubResponse<T> = {
  code?: string;
  message?: string;
  data?: T;
};

type CustomAgentsState = {
  agents: HubCustomAgent[];
  error?: string;
  isLoading: boolean;
  source: 'hub' | 'catalog';
};

function isHubResponse<T>(value: unknown): value is HubResponse<T> {
  return typeof value === 'object' && value !== null && ('data' in value || 'code' in value);
}

function unwrapHubResponse<T>(value: unknown): T {
  if (isHubResponse<T>(value)) {
    return (value.data ?? []) as T;
  }

  return value as T;
}

function formatHubError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Hub custom agent catalog unavailable');
}

export function useHubCustomAgents(token: string | null) {
  const [state, setState] = useState<CustomAgentsState>({
    agents: [],
    isLoading: false,
    source: 'catalog',
  });

  useEffect(() => {
    if (!token) {
      setState({ agents: [], isLoading: false, source: 'catalog' });
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;
    const timeoutId = window.setTimeout(() => controller.abort(), 2500);

    setState((current) => ({ ...current, isLoading: true, error: undefined }));

    fetch(`${getHubBaseUrl()}/web/custom-agents`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          let message = response.statusText;
          try {
            const body = await response.json();
            message = body?.message || body?.error?.message || message;
          } catch {
            // Keep the HTTP status text when Hub returns a non-JSON error.
          }
          throw new Error(message || `Hub responded with ${response.status}`);
        }

        return response.json();
      })
      .then((body) => {
        if (cancelled) return;
        setState({
          agents: unwrapHubResponse<HubCustomAgent[]>(body),
          isLoading: false,
          source: 'hub',
        });
      })
      .catch((error) => {
        if (cancelled) return;
        if (controller.signal.aborted) {
          setState({
            agents: [],
            error: 'Hub custom agent catalog timed out',
            isLoading: false,
            source: 'catalog',
          });
          return;
        }

        setState({
          agents: [],
          error: formatHubError(error),
          isLoading: false,
          source: 'catalog',
        });
      })
      .finally(() => window.clearTimeout(timeoutId));

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [token]);

  return state;
}
