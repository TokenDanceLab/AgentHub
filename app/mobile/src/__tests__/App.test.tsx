import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../App';

Element.prototype.scrollIntoView = vi.fn();

vi.mock('../native/mobileCommands', () => ({
  signIn: vi.fn(),
  checkSession: vi.fn(),
  clearSession: vi.fn(),
  testAlert: vi.fn(),
}));

vi.mock('../native/hubHealth', () => ({
  checkHubHealth: vi.fn(() => Promise.resolve({ reachable: true })),
  getMobileHubHealth: vi.fn(() => Promise.resolve({ status: "ok" })),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('Mobile App', () => {
  it('renders the bottom navigation bar', () => {
    renderWithProviders(<App />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('starts on the threads view', () => {
    renderWithProviders(<App />);
    expect(screen.getByRole('heading', { name: 'Threads', level: 1 })).toBeInTheDocument();
  });
});
