import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getResolvedBinding,
  hasCustomKeybindings,
  resetKeybindings,
} from '@shared/utils/keyboardShortcuts';
import type { SettingsPageProps } from './types';
import { ShortcutsPane } from './SettingsPanes';

/* #1853 coverage: the ShortcutsPane remap recorder (recording / conflict /
   reset flows) had no UI caller tests before — the settings page was the
   dead claim #1822 revived. */

const paneProps: SettingsPageProps = {
  activePane: 'shortcuts',
  spaceTitle: 'Space',
  spaceMeta: 'Meta',
  theme: 'dark',
  density: 'comfortable',
  runStepDefault: 'expanded',
  animationIntensity: 'none',
  inspectorVisible: true,
  stackedAvatars: false,
  taskCompleteNotify: false,
  approvalNotifyLevel: 'default',
  failureNotify: true,
  projectGroupNotifyLevel: 'default',
  docUpdateNotifyLevel: 'default',
  dndWindow: 'none',
  defaultModel: 'claude',
  defaultExecutor: 'desktop',
  toolCallDisplay: 'expanded',
  deepThinkingDisplay: 'hidden',
  permissions: {},
  vitePreviewUrl: '',
  dataMode: 'mock',
  composerSubmitBehavior: 'enter',
  workspacePath: '',
};

/** The remap button whose text currently shows the given combo. */
function remapButton(comboText: string): HTMLElement {
  const buttons = screen.getAllByRole('button', { name: '重新绑定' });
  const button = buttons.find((b) => b.textContent === comboText);
  if (!button) throw new Error(`no remap button showing "${comboText}"`);
  return button;
}

function renderPane(): void {
  render(<ShortcutsPane {...paneProps} />);
}

describe('ShortcutsPane (#1822 custom keybindings)', () => {
  beforeEach(() => {
    resetKeybindings();
  });
  afterEach(() => {
    resetKeybindings();
  });

  it('renders every canonical shortcut row with its key combo', () => {
    renderPane();
    for (const combo of [
      'Ctrl/⌘ + K',
      'Ctrl/⌘ + F',
      'Enter',
      'Shift + Enter',
      '@',
      '?',
      'Esc',
      'Ctrl/⌘ + B',
      'Ctrl/⌘ + J',
      'Ctrl/⌘ + P',
      'Ctrl/⌘ + ,',
    ]) {
      expect(remapButton(combo)).toBeInTheDocument();
    }
  });

  it('renders master-added canonical rows (product loops #1856)', () => {
    renderPane();
    for (const combo of [
      'Ctrl/⌘ + N',
      'Ctrl/⌘ + Alt + N',
      '/',
      'Ctrl/⌘ + O',
      'Ctrl/⌘ + W',
    ]) {
      expect(remapButton(combo)).toBeInTheDocument();
    }
  });

  it('#1823: selection-mode hotkeys render as fixed rows without a recorder', () => {
    renderPane();
    // The selection group rows show their combos as static text — no remap
    // button, because resolveSelectionHotkey owns those fixed bindings.
    expect(screen.getByText('Ctrl/⌘ + A')).toBeInTheDocument();
    expect(screen.getByText('Ctrl/⌘ + C')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    const remapButtons = screen.getAllByRole('button', { name: '重新绑定' });
    expect(remapButtons.map((b) => b.textContent)).not.toContain('Ctrl/⌘ + A');
    expect(remapButtons.map((b) => b.textContent)).not.toContain('Delete');
    // 19 canonical bindings − 3 non-rebindable selection rows = 16 recorders.
    expect(remapButtons).toHaveLength(16);
  });

  it('records a new combo on click + keydown and persists it immediately', () => {
    renderPane();
    fireEvent.click(remapButton('Ctrl/⌘ + K'));
    // Recording mode label replaces the combo text.
    expect(screen.getByText('按下…')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'l', ctrlKey: true });

    expect(remapButton('Ctrl + L')).toBeInTheDocument();
    expect(getResolvedBinding('search')).toEqual(['Ctrl', 'L']);
    expect(hasCustomKeybindings()).toBe(true);
    // Reset becomes available once a custom binding exists.
    expect(screen.getByRole('button', { name: '重置为默认' })).toBeEnabled();
  });

  it('Escape cancels recording without saving', () => {
    renderPane();
    fireEvent.click(remapButton('Ctrl/⌘ + F'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(remapButton('Ctrl/⌘ + F')).toBeInTheDocument();
    expect(getResolvedBinding('chat-search')).toEqual(['Ctrl/⌘', 'F']);
    expect(hasCustomKeybindings()).toBe(false);
  });

  it('rejects a combo that collides with another canonical binding', () => {
    renderPane();
    fireEvent.click(remapButton('Ctrl/⌘ + K'));
    // 'Enter' is the canonical send binding — recording it on search must
    // conflict instead of overwriting the send shortcut.
    fireEvent.keyDown(document, { key: 'Enter' });

    // #2154 P3-6: the copy names the colliding shortcut through its labelKey.
    // This suite runs in the key-echo test language, so tc() echoes
    // 'shortcut.send'; SettingsPanes.shortcutsConflict.test.tsx pins the
    // localized zh label. What must never appear is the bare internal id.
    expect(screen.getByText('该组合与「shortcut.send」冲突，未保存')).toBeInTheDocument();
    expect(screen.queryByText('该组合与「send」冲突，未保存')).not.toBeInTheDocument();
    expect(getResolvedBinding('search')).toEqual(['Ctrl/⌘', 'K']);
    expect(hasCustomKeybindings()).toBe(false);
  });

  it('reset clears custom bindings and restores canonical combos', () => {
    renderPane();
    fireEvent.click(remapButton('Ctrl/⌘ + B'));
    fireEvent.keyDown(document, { key: 'm', ctrlKey: true });
    expect(remapButton('Ctrl + M')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重置为默认' }));

    expect(remapButton('Ctrl/⌘ + B')).toBeInTheDocument();
    expect(getResolvedBinding('toggle-sidebar')).toEqual(['Ctrl/⌘', 'B']);
    expect(hasCustomKeybindings()).toBe(false);
    expect(screen.getByRole('button', { name: '重置为默认' })).toBeDisabled();
  });

  it('reset stays disabled until a custom binding or recording exists', () => {
    renderPane();
    expect(screen.getByRole('button', { name: '重置为默认' })).toBeDisabled();
  });

  it('#1853 review: recording a second shortcut preserves the first remap', () => {
    renderPane();
    fireEvent.click(remapButton('Ctrl/⌘ + K'));
    fireEvent.keyDown(document, { key: 'l', ctrlKey: true });
    expect(remapButton('Ctrl + L')).toBeInTheDocument();

    fireEvent.click(remapButton('Ctrl/⌘ + B'));
    fireEvent.keyDown(document, { key: 'm', ctrlKey: true });

    expect(remapButton('Ctrl + L')).toBeInTheDocument();
    expect(remapButton('Ctrl + M')).toBeInTheDocument();
    expect(getResolvedBinding('search')).toEqual(['Ctrl', 'L']);
    expect(getResolvedBinding('toggle-sidebar')).toEqual(['Ctrl', 'M']);
  });

  it('#1853 review: conflict rejection shows on the recorded row', () => {
    renderPane();
    fireEvent.click(remapButton('Ctrl/⌘ + K'));
    fireEvent.keyDown(document, { key: 'Enter' });

    // The recorded row (search) carries the rejection message naming the
    // colliding shortcut by its label key — not the send row (#2154 P3-6).
    expect(screen.getByText('该组合与「shortcut.send」冲突，未保存')).toBeInTheDocument();
    expect(remapButton('Ctrl/⌘ + K')).toBeInTheDocument();
    expect(remapButton('Enter')).toBeInTheDocument();
  });
});
