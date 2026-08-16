import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { TranscriptBlock } from '../adapter';

/* ──────────────────────────────────────────────────────────────────────
   Approval-arrival live region tests (#1503).

   Waiting approval cards live inside the Transcript's role=log region and
   are unmounted under virtualization while off-screen, so their arrival is
   never announced to screen readers. ChatViewTranscript must announce newly
   arrived approval requests through a live region OUTSIDE the virtualizer,
   once per row id.
   ────────────────────────────────────────────────────────────────────── */

// These assertions use the en chatview literals; opt into the en bundle of
// the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '../../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

vi.mock('virtua', () => ({
  // jsdom has no layout engine; a passthrough Virtualizer renders every child.
  Virtualizer: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

// Must import after the mocks
import { ChatViewTranscript } from './ChatViewTranscript';

const makeAuthor = (id: string) => ({ id, name: 'Builder', role: 'agent' as const });
const makeTime = (offsetMin = 0) => new Date(Date.UTC(2026, 5, 17, 14, 30 + offsetMin)).toISOString();

function permissionRequestBlock(id: string, toolName: string): TranscriptBlock {
  return {
    id,
    kind: 'permission_request',
    createdAt: makeTime(1),
    author: makeAuthor('b1'),
    requestId: id,
    title: 'Allow file write',
    status: 'pending',
    toolName,
    reason: 'needs review',
  } as TranscriptBlock;
}

function completedApprovalBlock(id: string, toolName: string): TranscriptBlock {
  return {
    id,
    kind: 'approval',
    createdAt: makeTime(1),
    author: makeAuthor('b1'),
    title: 'Deploy approval',
    status: 'completed',
    toolName,
  } as TranscriptBlock;
}

describe('ChatViewTranscript approval arrival live region (#1503)', () => {
  it('announces a newly-arrived waiting approval request with the tool name', () => {
    render(<ChatViewTranscript transcript={[permissionRequestBlock('pr1', 'Write')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Approval request received: Write');
  });

  it('does not re-announce an already-announced approval on re-render', () => {
    const blocks = [permissionRequestBlock('pr1', 'Write')];
    const { rerender } = render(<ChatViewTranscript transcript={blocks} />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('Approval request received: Write');

    rerender(<ChatViewTranscript transcript={blocks} />);
    expect(region.textContent).toBe('Approval request received: Write');
  });

  it('announces a distinct second approval request when it arrives', () => {
    const { rerender } = render(<ChatViewTranscript transcript={[permissionRequestBlock('pr1', 'Write')]} />);
    rerender(<ChatViewTranscript transcript={[permissionRequestBlock('pr1', 'Write'), permissionRequestBlock('pr2', 'Read')]} />);
    const region = screen.getByRole('status');
    expect(region.textContent).toContain('Approval request received: Read');
  });

  it('does not announce completed approvals or non-waiting rows', () => {
    render(<ChatViewTranscript transcript={[completedApprovalBlock('ap1', 'Write')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
