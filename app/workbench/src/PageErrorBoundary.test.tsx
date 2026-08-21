import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PageErrorBoundary } from './PageErrorBoundary';

function Thrower({ error }: { error: Error }): never {
  throw error;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  sessionStorage.clear();
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('PageErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <PageErrorBoundary>
        <p>Page content</p>
      </PageErrorBoundary>,
    );
    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  it('catches render errors and shows error UI', () => {
    render(
      <PageErrorBoundary>
        <Thrower error={new Error('page crashed')} />
      </PageErrorBoundary>,
    );
    expect(screen.queryByText('Page content')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('calls onReset when user retries', () => {
    const onReset = vi.fn();
    render(
      <PageErrorBoundary onReset={onReset}>
        <Thrower error={new Error('reset test')} />
      </PageErrorBoundary>,
    );
    const retryButton = screen.getByText('Retry');
    fireEvent.click(retryButton);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
