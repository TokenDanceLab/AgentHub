import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'AgentHubWorkbench.module.css');
const css = readFileSync(cssPath, 'utf8');

const runtimeStyleKeys = [
  'workspaceThread',
  'workspaceTabs',
  'workspaceTab',
  'workspaceTabIconOnly',
  'workspaceActions',
  'iconButton',
  'composer',
  'composerRow',
  'composerInput',
  'composerMentions',
  'composerMentionChip',
  'composerMainchain',
  'composerAgentPicker',
  'composerAgentSelect',
  'composerTargetPicker',
  'composerTargetSelect',
  'composerStatus',
  'attachmentButton',
  'composerAttachmentBar',
  'attachmentChip',
  'attachmentChipName',
  'attachmentChipSize',
  'attachmentChipRemove',
  'sendButton',
] as const;

describe('AgentHubWorkbench CSS module contract', () => {
  it('keeps runtime classes used by the workspace header and composer', () => {
    for (const key of runtimeStyleKeys) {
      expect(css, key).toMatch(new RegExp(`\\.${key}\\b`));
    }
  });

  it('keeps ChatView as the only transcript scroll container in the workbench', () => {
    expect(css).toMatch(/\.transcriptRegion\s*\{[^}]*overflow-y:\s*hidden;/s);
    expect(css).not.toMatch(/\.transcriptRegion\s*\{[^}]*overflow-y:\s*auto;/s);
  });

  it('does not keep stale ChatView row and bubble classes in the workbench module', () => {
    expect(css).not.toMatch(/\.transcript\s*\{/);
    expect(css).not.toMatch(/\.block\s*\{/);
    expect(css).not.toMatch(/\.blockText\b/);
    expect(css).not.toMatch(/\.agentBlockRow\b/);
    expect(css).not.toMatch(/\.workspaceDataMode\b/);
  });

  it('keeps the terminal dock under workspace + inspector only (not rail/sidebar)', () => {
    // Dock spans shell columns 3–4 (workspace + inspector), not full width over channel list.
    expect(css).toMatch(/\.terminalDock\s*\{[^}]*grid-column:\s*3\s*\/\s*-1;/s);
    expect(css).not.toMatch(/\.terminalDock\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s);

    // Rail keeps full height; the sidebar stops above the global status
    // bar so conversation cards are not shortened beside the dock (#1994).
    expect(css).toMatch(/\.rail\s*\{[^}]*grid-row:\s*1\s*\/\s*-1;/s);
    expect(css).toMatch(/\.sidebarFrame\s*\{[^}]*grid-row:\s*1\s*\/\s*3;/s);

    // The global status bar spans everything right of the rail on row 3.
    expect(css).toMatch(/\.workbenchStatusBar\s*\{[^}]*grid-column:\s*2\s*\/\s*-1;[^}]*grid-row:\s*3;/s);
  });
});
