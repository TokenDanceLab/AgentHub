// #2241 lane B task 3 (gate side) — with a forward port wired, the transcript
// context menu renders the "转发" entry again and the picker's confirmed
// targets reach that port; without the port the entry stays hidden (#2154
// fail-closed invariant — must not regress).
//
// Rendered through the REAL AgentHubWorkbench (no gate/mapper mocks) with a
// Desktop-shaped wiring: `activeConversationId` doubles as the session id and
// the transcript block ids carry the `hub-message-` prefix that parents strip
// before the Hub REST call (the stripping + the real Hub call are pinned by
// app/desktop/src/__tests__/App.messageActions.test.tsx).
import { installWorkbenchTestHooks } from './helpers';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import type { WorkbenchConversation } from '@shared/platform';
import type { TranscriptBlock } from '@shared/transcript/types';
import { AgentHubWorkbench } from '../AgentHubWorkbench';
import { workbenchAgents as agents } from '../workbenchTestFixtures';

installWorkbenchTestHooks();

const conversations: WorkbenchConversation[] = [
  { id: 'sess-1', title: '当前会话', kind: 'direct' },
  { id: 'sess-2', title: '架构评审', kind: 'group' },
];

const transcript: TranscriptBlock[] = [
  {
    id: 'hub-message-m1',
    kind: 'text',
    author: { id: 'u1', name: 'You', role: 'human' },
    createdAt: '2026-09-01T09:30:00.000Z',
    text: '把这条转给评审群',
  },
];

function renderWorkbench(
  onForwardMessage?: ((messageId: string, targetSessionIds: string[]) => Promise<void> | void) | undefined,
) {
  const platform = createMockPlatform({ surface: 'desktop', conversations });
  return render(
    <AgentHubWorkbench
      agents={agents}
      platform={platform}
      conversations={platform.seed.conversations}
      transcript={transcript}
      activeConversationId="sess-1"
      {...(onForwardMessage ? { onForwardMessage } : {})}
    />,
  );
}

function openBlockMenu(container: HTMLElement): HTMLElement {
  const card = container.querySelector('[data-selectable-card="hub-message-m1"]');
  expect(card, 'the user transcript card must render').not.toBeNull();
  fireEvent.contextMenu(card!, { clientX: 120, clientY: 180 });
  return screen.getByRole('menu');
}

describe('transcript forward entry with a wired port (#2241)', () => {
  it('renders the entry and dispatches the confirmed targets to the port', () => {
    const onForwardMessage = vi.fn();
    const { container } = renderWorkbench(onForwardMessage);
    const menu = openBlockMenu(container);

    const forwardItem = within(menu).getByRole('menuitem', { name: /转发/ });
    // Chevron item: clicking opens the picker submenu and must NOT take the
    // targetless forward path (#1385 — that one only ever produced a "请先选择
    // 目标会话再转发" toast).
    fireEvent.click(forwardItem);

    const picker = screen.getByRole('listbox', { name: '选择转发目标会话' });
    fireEvent.click(within(picker).getByText('架构评审'));
    fireEvent.click(screen.getByRole('button', { name: '确认转发' }));

    // The chrome hands over the RAW block id; stripping `hub-message-` is the
    // parent's job (contract in AgentHubWorkbenchTypes.ts).
    expect(onForwardMessage).toHaveBeenCalledTimes(1);
    expect(onForwardMessage).toHaveBeenCalledWith('hub-message-m1', ['sess-2']);
  });

  it('keeps the entry hidden when the shell wires no forward port (#2154)', () => {
    const { container } = renderWorkbench(undefined);
    const menu = openBlockMenu(container);

    expect(within(menu).queryByRole('menuitem', { name: /转发/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: '选择转发目标会话' })).not.toBeInTheDocument();
  });
});
