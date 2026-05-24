import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Shared fetch mock for apiClient / eventClient tests.
// Tests can reset/override this per-suite via vi.mocked(fetch).mockImplementation.
globalThis.fetch = vi.fn();

// Re-export testing utilities so shared component tests import from one place.
export { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
