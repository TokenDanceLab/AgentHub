import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
    const cssPath = path.resolve(process.cwd(), '../shared/src/workbench/AgentHubWorkbench.module.css');
    const css = readFileSync(cssPath, 'utf8');

    for (const key of runtimeStyleKeys) {
      expect(css, key).toMatch(new RegExp(`\\.${key}\\b`));
    }
  });

  it('keeps ChatView as the only transcript scroll container in the workbench', () => {
    const cssPath = path.resolve(process.cwd(), '../shared/src/workbench/AgentHubWorkbench.module.css');
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.transcriptRegion\s*\{[^}]*overflow-y:\s*hidden;/s);
    expect(css).not.toMatch(/\.transcriptRegion\s*\{[^}]*overflow-y:\s*auto;/s);
  });

  it('does not keep stale ChatView row and bubble classes in the workbench module', () => {
    const cssPath = path.resolve(process.cwd(), '../shared/src/workbench/AgentHubWorkbench.module.css');
    const css = readFileSync(cssPath, 'utf8');

    expect(css).not.toMatch(/\.transcript\s*\{/);
    expect(css).not.toMatch(/\.block\s*\{/);
    expect(css).not.toMatch(/\.blockText\b/);
    expect(css).not.toMatch(/\.agentBlockRow\b/);
    expect(css).not.toMatch(/\.workspaceDataMode\b/);
  });
});
