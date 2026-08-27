// ConversationHost goal banner mount contract (#1998, UX F8).
// Real ConversationHost with heavy sibling chrome stubbed (checkpoint-test
// harness pattern): the transcript carries REAL adapter-shaped goal events
// normalized through the shared mapper. Asserts the banner appears only for
// goal conversations and that the stop control degrades to zero controls
// when onCancelRun is not wired.
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';

import { createInitialComposerState } from '@shared/composer';
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import type { EventEnvelope } from '@shared/events';
import type { TranscriptBlock } from '@shared/transcript';
import { toolCallBlock } from '@shared/transcript/edgeEventMappersTools';
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

vi.mock('./ChatViewBridge', () => ({
  ChatViewBridge: () => <div data-testid="chat-view-bridge" />,
}));

vi.mock('./WorkspaceHeader', () => ({
  WorkspaceHeader: () => <div data-testid="workspace-header" />,
}));

vi.mock('./ComposerDispatchQueue', () => ({
  ComposerDispatchQueue: () => null,
}));

vi.mock('./MessageSearchPanel', () => ({
  default: () => null,
}));

vi.mock('./UnifiedComposer', () => ({
  UnifiedComposer: () => <div data-testid="composer" />,
}));

// Must import after the mocks.
import { ConversationHost } from './ConversationHost';

let seq = 0;
function goalEventBlock(
  toolName: string,
  input: Record<string, unknown> | undefined,
): TranscriptBlock {
  seq += 1;
  const event: EventEnvelope = {
    version: 'v1',
    id: `evt-mount-${seq}`,
    seq,
    type: 'run.agent.tool_call',
    scope: { threadId: 'thread-mount', runId: 'run-mount' },
    sentAt: `2026-08-28T04:00:${String(seq).padStart(2, '0')}Z`,
    payload: {
      callId: `call-mount-${seq}`,
      toolName,
      status: 'completed',
      ...(input !== undefined ? { input } : {}),
    },
  };
  const block = toolCallBlock(event);
  if (!block) throw new Error('fixture event failed to normalize');
  return block;
}

function textBlock(id: string, text: string): TranscriptBlock {
  return { id, kind: 'text', author: { id: 'user', name: 'User', role: 'human' }, text };
}

function renderHost(
  transcript: TranscriptBlock[],
  onCancelRun?: (() => void) | undefined,
) {
  const platform = createMockPlatform();
  return render(
    <ConversationHost
      transcript={transcript}
      inspectorCollapsed={false}
      onToggleInspector={() => {}}
      onAgentClick={() => {}}
      onBlockContextMenu={() => {}}
      onBlockSelect={() => {}}
      onBlockAction={() => {}}
      onReviewFile={() => {}}
      onDeploySubmit={() => {}}
      selectedBlockIds={new Set<string>()}
      selectionMode={false}
      softHiddenBlockIds={new Set<string>()}
      actionedBlockIds={new Set<string>()}
      dismissedPinnedIds={new Set<string>()}
      onToast={() => {}}
      selectedExecutionTargetId="local"
      onExecutionTargetChange={() => {}}
      mentionableAgents={[]}
      showComposerAgentPicker={false}
      showComposerStatus={false}
      composerTargetLabel="Local"
      currentConversationId="conv-goal"
      platform={platform}
      composer={createInitialComposerState('conv-goal')}
      dispatchComposer={() => {}}
      composerInputRef={React.createRef<HTMLTextAreaElement>()}
      searchOpen={false}
      onSearchOpenChange={() => {}}
      {...(onCancelRun ? { onCancelRun } : {})}
    />,
  );
}

describe('ConversationHost goal banner mount (#1998)', () => {
  it('renders the banner for a conversation with a derivable goal', () => {
    renderHost([
      textBlock('mt-1', 'Start the long migration'),
      goalEventBlock('create_goal', { objective: 'Migrate every endpoint wrapper' }),
    ]);
    const banner = screen.getByRole('region', { name: 'Conversation goal' });
    expect(banner).toHaveAttribute('data-goal-status', 'active');
    expect(screen.getByText('Migrate every endpoint wrapper')).toBeInTheDocument();
  });

  it('renders no banner for a goal-less conversation', () => {
    renderHost([
      textBlock('mt-2', 'Just a question'),
      goalEventBlock('Read', { path: 'src/main.ts' }),
    ]);
    expect(screen.queryByRole('region', { name: 'Conversation goal' })).toBeNull();
  });

  it('degrades to zero controls when onCancelRun is not wired', () => {
    renderHost([goalEventBlock('create_goal', { objective: 'No control surface' })]);
    const banner = screen.getByRole('region', { name: 'Conversation goal' });
    expect(banner.querySelector('button')).toBeNull();
  });

  it('wires the stop entry when onCancelRun is present', () => {
    const onCancelRun = vi.fn();
    renderHost(
      [goalEventBlock('create_goal', { objective: 'Stoppable goal' })],
      onCancelRun,
    );
    const stop = screen.getByRole('button', { name: 'Stop the current run' });
    fireEvent.click(stop);
    expect(onCancelRun).toHaveBeenCalledTimes(1);
  });
});
