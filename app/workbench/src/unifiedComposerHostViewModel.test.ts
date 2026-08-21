import { describe, expect, it } from 'vitest';
import type { ComposerState } from '@shared/composer';
import { deriveUnifiedComposerState } from './unifiedComposerHelpers';
import {
  buildComposerHostChromeModel,
  buildComposerHostViewModel,
  buildUnifiedComposerHostState,
  composerInputPlaceholder,
  deriveComposerChromeVisibility,
  resolveComposerHostRuntime,
  shouldClearExecutionTarget,
} from './unifiedComposerHostViewModel';

const baseComposer: ComposerState = {
  conversationId: 'hub-session-1',
  text: 'Run the real task',
  mode: 'code',
  mentions: [{ id: 'profile-builder', label: 'Builder', runtimeId: 'claude-code' }],
  attachments: [],
  approvalMode: 'suggest',
  workDir: '',
  submitState: 'idle',
  editingMessageId: null,
  replyTo: null,
  quote: null,
};

describe('unifiedComposerHostViewModel', () => {
  it('resolves host runtime defaults and placeholder text', () => {
    expect(composerInputPlaceholder('AgentHub')).toBe('发消息给 AgentHub');
    expect(resolveComposerHostRuntime({})).toEqual({
      executionTargetId: '',
      mentionableAgents: [],
      submitBehavior: 'enter-send',
      targetLabel: 'AgentHub',
      hasNativePicker: false,
    });
    expect(resolveComposerHostRuntime({
      executionTargetId: 't1',
      mentionableAgents: [{ id: 'a1', label: 'A' }],
      submitBehavior: 'ctrl-enter-send',
      targetLabel: 'Desktop',
      onPickLocalAttachments: async () => [],
    })).toMatchObject({
      executionTargetId: 't1',
      submitBehavior: 'ctrl-enter-send',
      targetLabel: 'Desktop',
      hasNativePicker: true,
    });
  });

  it('clears stale execution targets', () => {
    expect(shouldClearExecutionTarget(
      [{ id: 't1', label: 'Desktop' }],
      't2',
    )).toBe(true);
    expect(shouldClearExecutionTarget(
      [{ id: 't1', label: 'Desktop' }],
      't1',
    )).toBe(false);
    expect(shouldClearExecutionTarget(undefined, 't1')).toBe(false);
  });

  it('derives chrome visibility and chrome model payloads', () => {
    const idle = deriveComposerChromeVisibility({
      composer: {
        ...baseComposer,
        mentions: [],
        text: '',
      },
      mentionableAgentsCount: 0,
      hasExecutionTargets: false,
      statusItemsCount: 0,
    });
    expect(idle).toEqual({
      replyBar: false,
      quoteBar: false,
      mentionChips: false,
      mainchainStrip: false,
      attachmentBar: false,
      agentPicker: false,
      targetPicker: false,
      statusStrip: false,
    });

    const richComposer: ComposerState = {
      ...baseComposer,
      replyTo: {
        messageId: 'm1',
        author: 'Ada',
        preview: 'hello',
      },
      quote: {
        messageId: 'm2',
        author: 'Bob',
        text: 'quoted',
      },
      attachments: [{
        id: 'a1',
        name: 'notes.txt',
        mime: 'text/plain',
        size: 12,
      }],
    };
    const derived = deriveUnifiedComposerState({
      composer: richComposer,
      executionTargets: [{ id: 't1', label: 'Desktop' }],
      executionTargetId: 't1',
      mentionableAgents: [
        { id: 'profile-builder', label: 'Builder', runtimeId: 'claude-code' },
        { id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' },
      ],
      status: { dataMode: 'approved-real' },
    });
    const chrome = deriveComposerChromeVisibility({
      composer: richComposer,
      mentionableAgentsCount: 2,
      hasExecutionTargets: true,
      statusItemsCount: derived.statusItems.length,
    });
    const model = buildComposerHostChromeModel({
      composer: richComposer,
      derived,
      executionTargets: [{ id: 't1', label: 'Desktop' }],
      executionTargetId: 't1',
      uploadProgresses: { a1: { percent: 10, phase: 'hashing' } },
      chrome,
    });

    expect(model.replyTo?.author).toBe('Ada');
    expect(model.quote?.text).toBe('quoted');
    expect(model.mentions).toHaveLength(1);
    expect(model.mainchain?.mainchainTask).toBe('ready');
    expect(model.attachment?.uploadProgresses?.a1?.percent).toBe(10);
    expect(model.agentOptions).toHaveLength(1);
    expect(model.targetPicker?.executionTargetId).toBe('t1');
    expect(model.statusItems).toContain('数据：真实数据');
  });

  it('builds host view-model and combined host state', () => {
    const vm = buildComposerHostViewModel({
      composer: baseComposer,
      executionTargets: [{ id: 'target-local-edge-1', label: 'Alpha Desktop' }],
      executionTargetId: '',
      mentionableAgents: [
        { id: 'profile-builder', label: 'Builder', runtimeId: 'claude-code' },
        { id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' },
      ],
      status: { dataMode: 'approved-real' },
      targetLabel: 'AgentHub',
      uploadProgresses: undefined,
      fileAccept: 'image/*',
    });

    expect(vm.targetSelectionRequired).toBe(true);
    expect(vm.targetSelected).toBe(false);
    expect(vm.submitDisabled).toBe(true);
    expect(vm.selectedAgentLabel).toBe('@Builder');
    expect(vm.availableMentionOptions).toHaveLength(1);
    expect(vm.hasMentions).toBe(true);
    expect(vm.inputPlaceholder).toBe('发消息给 AgentHub');
    expect(vm.fileAccept).toBe('image/*');
    expect(vm.chrome.mentionChips).toBe(true);
    expect(vm.chromeModel.mentions).toHaveLength(1);

    const host = buildUnifiedComposerHostState({
      composer: baseComposer,
      executionTargets: [{ id: 'target-local-edge-1', label: 'Alpha Desktop' }],
      executionTargetId: undefined,
      mentionableAgents: [
        { id: 'profile-builder', label: 'Builder', runtimeId: 'claude-code' },
      ],
      status: { dataMode: 'approved-real' },
      uploadProgresses: undefined,
    });
    expect(host.runtime.executionTargetId).toBe('');
    expect(host.runtime.targetLabel).toBe('AgentHub');
    expect(host.view.hasMentions).toBe(true);
    expect(host.view.fileAccept.length).toBeGreaterThan(0);
  });
});
