import { type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/ThemeContext';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
}

export function renderWithProviders(ui: ReactElement): RenderWithProvidersResult {
  const queryClient = makeQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {ui}
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

export { makeQueryClient };
export { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
