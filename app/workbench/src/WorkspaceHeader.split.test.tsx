// real_tested=true
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkbenchConversation } from '@shared/platform';
import { WorkspaceHeader } from './WorkspaceHeader';
import type { WorkbenchSplitControls } from './workbenchFrameTypes';
import { useTestI18nLanguage } from '@shared/testing/i18n';

/* ═══════════════════════════════════════════════════════════════════════
   WorkspaceHeader split menu (#1997, UX F3): entry visibility, context-menu
   flow (Split Right / Split Down / Move to Group / Unsplit) and the
   header right-click shortcut.
   ═══════════════════════════════════════════════════════════════════════ */

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

const conversation: WorkbenchConversation = { id: 'conv-a', title: 'Alpha', kind: 'direct' };

function makeControls(overrides: Partial<WorkbenchSplitControls> = {}): WorkbenchSplitControls {
  return {
    hasSplit: false,
    moveTargets: [],
    onSplitRight: vi.fn(),
    onSplitDown: vi.fn(),
    onUnsplit: vi.fn(),
    onMoveToPane: vi.fn(),
    ...overrides,
  };
}

function renderHeader(controls?: WorkbenchSplitControls) {
  return render(
    <WorkspaceHeader
      activeConversation={conversation}
      inspectorCollapsed={false}
      onToggleInspector={() => {}}
      {...(controls ? { splitControls: controls } : {})}
    />,
  );
}

describe('WorkspaceHeader split menu (#1997)', () => {
  it('renders no split entry without controls (honesty gate upstream)', () => {
    renderHeader();
    expect(screen.queryByTestId('workbench-split-menu')).toBeNull();
  });

  it('offers Split Right and Split Down before any split exists', () => {
    const controls = makeControls();
    renderHeader(controls);
    fireEvent.click(screen.getByTestId('workbench-split-menu'));

    const splitRight = screen.getByRole('menuitem', { name: /Split Right/ });
    fireEvent.click(splitRight);
    expect(controls.onSplitRight).toHaveBeenCalledTimes(1);

    // Menu closes after the action; reopen for Split Down.
    fireEvent.click(screen.getByTestId('workbench-split-menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Split Down/ }));
    expect(controls.onSplitDown).toHaveBeenCalledTimes(1);
  });

  it('adds Move to Group and Unsplit while a split is active', () => {
    const controls = makeControls({
      hasSplit: true,
      moveTargets: [{ paneId: 'pane-2', title: 'Beta' }],
    });
    renderHeader(controls);
    fireEvent.click(screen.getByTestId('workbench-split-menu'));

    expect(screen.getByRole('menuitem', { name: /Unsplit/ })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /Move to Group/ })).not.toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: /Unsplit/ }));
    expect(controls.onUnsplit).toHaveBeenCalledTimes(1);
  });

  it('moves the active conversation into the chosen group', () => {
    const controls = makeControls({
      hasSplit: true,
      moveTargets: [{ paneId: 'pane-2', title: 'Beta' }],
    });
    renderHeader(controls);
    fireEvent.click(screen.getByTestId('workbench-split-menu'));

    // Open the Move-to-Group submenu, then pick the listed target.
    fireEvent.click(screen.getByRole('menuitem', { name: /Move to Group/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Beta' }));
    expect(controls.onMoveToPane).toHaveBeenCalledWith('pane-2');
  });

  it('opens the same menu on header right-click', () => {
    renderHeader(makeControls());
    const header = document.querySelector('header');
    expect(header).not.toBeNull();
    fireEvent.contextMenu(header as HTMLElement);
    expect(screen.getByRole('menu')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /Split Right/ })).not.toBeNull();
  });

  it('exposes aria state for the menu trigger', () => {
    renderHeader(makeControls());
    const button = screen.getByTestId('workbench-split-menu');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
