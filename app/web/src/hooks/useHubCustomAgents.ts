import { useEffect, useState } from 'react';
import {
  createHubClient,
  type HubCustomAgent,
} from '@shared/index';
import { getHubBaseUrl } from './useHubSession';

export type { HubCustomAgent };

type CustomAgentsState = {
  agents: HubCustomAgent[];
  error?: string;
  isLoading: boolean;
  source: 'hub' | 'catalog';
};

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

    setState((current) => ({
      agents: current.agents,
      isLoading: true,
      source: current.source,
    }));

    const client = createHubClient({
      baseUrl: getHubBaseUrl(),
      fetch: (input, init) => fetch(input, { ...init, signal: controller.signal }),
      getToken: () => token,
    });

    client
      .listCustomAgents()
      .then((agents) => {
        if (cancelled) return;
        setState({
          agents,
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
