import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetKeybindings } from '@shared/utils/keyboardShortcuts';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import type { SettingsPageProps } from './types';
import { ShortcutsPane } from './SettingsPanes';

/* ═══════════════════════════════════════════════════════════════════════
   Shortcut conflict copy under the real zh bundle (#2154 P3-6).

   The pane used to print the colliding binding's internal id (`send`) and one
   of the two conflict sentences was hardcoded Chinese outside i18n. Both now
   resolve the other shortcut's labelKey through the chatview namespace, so the
   user reads "发送消息" instead of a code identifier.
   ═══════════════════════════════════════════════════════════════════════ */

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

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

describe('ShortcutsPane conflict copy (#2154 P3-6)', () => {
  beforeEach(() => {
    resetKeybindings();
  });
  afterEach(() => {
    resetKeybindings();
  });

  it('names the colliding shortcut with its localized label, not its internal id', () => {
    render(<ShortcutsPane {...paneProps} />);

    fireEvent.click(remapButton('Ctrl/⌘ + K'));
    // Enter is the canonical send binding — recording it on search conflicts.
    fireEvent.keyDown(document, { key: 'Enter' });

    expect(screen.getByText('该组合与「发送消息」冲突，未保存')).toBeInTheDocument();
    expect(screen.queryByText(/「send」/)).not.toBeInTheDocument();
    expect(screen.queryByText(/冲突: 与/)).not.toBeInTheDocument();
  });

  it('renders localized shortcut labels for the rows themselves', () => {
    render(<ShortcutsPane {...paneProps} />);

    // Sanity check that the chatview bundle is really active in this suite:
    // the send row shows its zh label rather than an echoed key.
    expect(screen.getByText('发送消息')).toBeInTheDocument();
    expect(screen.queryByText('shortcut.send')).not.toBeInTheDocument();
  });
});
