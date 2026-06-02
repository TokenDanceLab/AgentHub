import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PermissionDialog from '@/components/PermissionDialog';
import type { PermissionRequestItem } from '@/hooks/useChatMessages';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      const varStr = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return `${key}(${varStr})`;
    },
    i18n: { language: 'en' },
  }),
}));

function makeRequest(overrides: Partial<PermissionRequestItem> = {}): PermissionRequestItem {
  return {
    requestId: 'perm-1',
    runId: 'run-1',
    toolName: 'Bash',
    toolInput: { command: 'pnpm test' },
    timestamp: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PermissionDialog', () => {
  it('does not focus Allow when a pending permission appears', async () => {
    const onDecide = vi.fn();
    render(<PermissionDialog requests={[makeRequest()]} onDecide={onDecide} />);

    const allowButton = await screen.findByRole('button', { name: 'Allow Bash execution' });

    expect(document.activeElement).not.toBe(allowButton);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Enter' });
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('still allows and denies through explicit button actions', async () => {
    const onDecide = vi.fn();
    render(<PermissionDialog requests={[makeRequest()]} onDecide={onDecide} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Allow Bash execution' }));
    expect(onDecide).toHaveBeenCalledWith('perm-1', 'allow', undefined);

    onDecide.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Deny Bash execution' }));
    expect(onDecide).toHaveBeenCalledWith('perm-1', 'deny', 'user denied');
  });

  it('keeps the panel expanded for a new pending request', async () => {
    render(<PermissionDialog requests={[makeRequest()]} onDecide={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('perm.awaiting')).toBeInTheDocument();
    });
  });
});
