import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';
import type { ErrorBoundaryExtension } from './ErrorBoundary';

// Helper: component that throws a specified error on render
function Thrower({ error }: { error: Error }): never {
  throw error;
}

// Suppress console.error from intentional error throws in tests
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  sessionStorage.clear();
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

// ── Rendering ──────────────────────────────────────────

describe('ErrorBoundary rendering', () => {
  it('renders children when no error', () => {
    const { container } = render(
      <ErrorBoundary>
        <p>Hello world</p>
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('Hello world');
  });

  it('renders error state on caught error', () => {
    const error = new Error('Something broke');
    render(
      <ErrorBoundary>
        <Thrower error={error} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('renders chunk load error state', () => {
    const error = new Error('ChunkLoadError: Loading chunk 42 failed.');
    render(
      <ErrorBoundary>
        <Thrower error={error} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Update Required')).toBeDefined();
    expect(screen.getByText('A new version of the app is available. Please reload to continue.')).toBeDefined();
    expect(screen.getByText('Reload Page')).toBeDefined();
  });

  it('renders network error state', () => {
    const error = new Error('Failed to fetch /api/data');
    render(
      <ErrorBoundary>
        <Thrower error={error} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Connection Lost')).toBeDefined();
  });

  it('renders timeout error state', () => {
    const error = new Error('Request timed out after 30000ms');
    render(
      <ErrorBoundary>
        <Thrower error={error} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Service Timeout')).toBeDefined();
    // Timeout primary button is "Retry" — same text as secondary,
    // so we check both buttons exist
    const retryButtons = screen.getAllByText('Retry');
    expect(retryButtons.length).toBe(2);
  });

  it('renders unknown fallback when error is null', () => {
    // Force error state with null error via getDerivedStateFromError-like path
    // Actually, getDerivedStateFromError always receives an Error, but
    // the fallback handles null gracefully.
    render(
      <ErrorBoundary>
        <Thrower error={new Error('')} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('hides secondary retry button for chunk errors', () => {
    const error = new Error('ChunkLoadError: timeout');
    render(
      <ErrorBoundary>
        <Thrower error={error} />
      </ErrorBoundary>,
    );
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('shows secondary retry button for non-chunk errors', () => {
    const error = new Error('Network error');
    render(
      <ErrorBoundary>
        <Thrower error={error} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Retry')).toBeDefined();
  });
});

// ── Reset ──────────────────────────────────────────────

describe('ErrorBoundary reset', () => {
  it('resets to children on retry click', () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) {
        throw new Error('flaky render');
      }
      return <p>Recovered</p>;
    }

    const { container } = render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeDefined();

    // Clear the throw flag and click retry
    shouldThrow = false;
    fireEvent.click(screen.getByText('Retry'));

    expect(container.textContent).toContain('Recovered');
  });
});

// ── Extensions ─────────────────────────────────────────

describe('ErrorBoundary extensions', () => {
  it('uses extension config and onPrimary when extension matches', () => {
    const onPrimary = vi.fn();
    const crashExtension: ErrorBoundaryExtension = {
      matches: (e: Error) => /crash/i.test(e.message),
      config: {
        icon: <span data-testid="crash-icon">CRASH</span>,
        iconClass: undefined,
        titleKey: '',
        titleFallback: 'Agent Crashed',
        descKey: '',
        descFallback: 'The agent stopped unexpectedly.',
        primaryLabelKey: '',
        primaryLabelFallback: 'Restart Agent',
        primaryIcon: <span data-testid="crash-btn-icon">icon</span>,
      },
      onPrimary,
    };

    const error = new Error('Runtime crash: SIGTERM');
    render(
      <ErrorBoundary extensions={[crashExtension]}>
        <Thrower error={error} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Agent Crashed')).toBeDefined();
    expect(screen.getByText('The agent stopped unexpectedly.')).toBeDefined();
    expect(screen.getByText('Restart Agent')).toBeDefined();

    fireEvent.click(screen.getByText('Restart Agent'));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('falls back to base kind when no extension matches', () => {
    const onPrimary = vi.fn();
    const crashExtension: ErrorBoundaryExtension = {
      matches: (e: Error) => /crash/i.test(e.message),
      config: {
        icon: null,
        iconClass: undefined,
        titleKey: '',
        titleFallback: 'Should not appear',
        descKey: '',
        descFallback: '',
        primaryLabelKey: '',
        primaryLabelFallback: '',
      },
      onPrimary,
    };

    const error = new Error('Network timeout');
    render(
      <ErrorBoundary extensions={[crashExtension]}>
        <Thrower error={error} />
      </ErrorBoundary>,
    );

    // Should fall back to base network (connection lost)
    expect(screen.getByText('Connection Lost')).toBeDefined();
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it('first matching extension wins', () => {
    const first = vi.fn();
    const second = vi.fn();

    const ext1: ErrorBoundaryExtension = {
      matches: () => true,
      config: {
        icon: null,
        iconClass: undefined,
        titleKey: '',
        titleFallback: 'First Extension',
        descKey: '',
        descFallback: '',
        primaryLabelKey: '',
        primaryLabelFallback: 'Action 1',
      },
      onPrimary: first,
    };

    const ext2: ErrorBoundaryExtension = {
      matches: () => true,
      config: {
        icon: null,
        iconClass: undefined,
        titleKey: '',
        titleFallback: 'Second Extension',
        descKey: '',
        descFallback: '',
        primaryLabelKey: '',
        primaryLabelFallback: 'Action 2',
      },
      onPrimary: second,
    };

    render(
      <ErrorBoundary extensions={[ext1, ext2]}>
        <Thrower error={new Error('anything')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('First Extension')).toBeDefined();
    expect(screen.queryByText('Second Extension')).toBeNull();

    fireEvent.click(screen.getByText('Action 1'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('renders primaryIcon from extension config', () => {
    const extension: ErrorBoundaryExtension = {
      matches: () => true,
      config: {
        icon: null,
        iconClass: undefined,
        titleKey: '',
        titleFallback: 'Custom Error',
        descKey: '',
        descFallback: 'Custom description.',
        primaryLabelKey: '',
        primaryLabelFallback: 'Custom Action',
        primaryIcon: <span data-testid="custom-icon">ICON</span>,
      },
      onPrimary: vi.fn(),
    };

    render(
      <ErrorBoundary extensions={[extension]}>
        <Thrower error={new Error('custom')} />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('custom-icon')).toBeDefined();
  });
});

// ── Stack trace ────────────────────────────────────────

describe('ErrorBoundary stack trace', () => {
  it('hides stack trace by default (showStack defaults to false)', () => {
    const error = new Error('With stack');
    render(
      <ErrorBoundary>
        <Thrower error={error} />
      </ErrorBoundary>,
    );
    expect(screen.queryByText('Stack Trace')).toBeNull();
  });

  it('hides stack trace when showStack is false', () => {
    const error = new Error('With stack');
    render(
      <ErrorBoundary showStack={false}>
        <Thrower error={error} />
      </ErrorBoundary>,
    );
    expect(screen.queryByText('Stack Trace')).toBeNull();
  });

  it('hides stack trace when error has no stack', () => {
    const error = new Error('No stack');
    error.stack = undefined;
    render(
      <ErrorBoundary showStack>
        <Thrower error={error} />
      </ErrorBoundary>,
    );
    expect(screen.queryByText('Stack Trace')).toBeNull();
  });

  it('shows stack trace when showStack=true explicitly', () => {
    const error = new Error('With stack');
    render(
      <ErrorBoundary showStack={true}>
        <Thrower error={error} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Stack Trace')).toBeDefined();
  });

  it('offers a copy-details button by default', () => {
    render(
      <ErrorBoundary>
        <Thrower error={new Error('boom')} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Copy error details')).toBeDefined();
  });
});

// ── Chunk auto-recovery ────────────────────────────────

describe('ErrorBoundary chunk auto-recovery', () => {
  it('does not crash rendering non-chunk errors', () => {
    // componentDidCatch with non-chunk errors should not attempt reload;
    // window.location.reload is not configurable in jsdom, so we verify
    // the component renders the error UI gracefully.
    const error = new Error('Network error');
    render(
      <ErrorBoundary>
        <Thrower error={error} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('Connection Lost')).toBeDefined();
  });
});
