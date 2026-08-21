import { describe, expect, it, vi } from 'vitest';
import type { ComposerState } from '@shared/composer';
import {
  buildComposerHostChromeModel,
  buildComposerHostViewModel,
  buildUnifiedComposerHostState,
  cancelQuoteAction,
  cancelReplyAction,
  composerAttachmentAddActions,
  composerCaretRestore,
  composerInputPlaceholder,
  deriveComposerChromeVisibility,
  planAddMentionAction,
  planComposerFilePick,
  planComposerHostKeyDown,
  planComposerHostKeyDownEffect,
  planComposerHostKeyDownFromEvent,
  planOpenFilePicker,
  readComposerKeyDownEventFields,
  removeAttachmentAction,
  removeMentionAction,
  resolveComposerFilePickAttachments,
  resolveComposerHostRuntime,
  resolveOpenFilePickerAttachments,
  setComposerTextAction,
  shouldClearExecutionTarget,
} from './unifiedComposerHostHelpers';
import { deriveUnifiedComposerState } from './unifiedComposerHelpers';

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

describe('unifiedComposerHostHelpers', () => {
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

  it('builds host view-model with derived labels and chrome', () => {
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
    expect(vm.statusItems).toContain('数据：真实数据');
    expect(vm.statusItems).toContain('请先选择执行目标再开始。');
    expect(vm.mainchainTask).toBe('draft required');
    expect(vm.hasMentions).toBe(true);
    expect(vm.inputPlaceholder).toBe('发消息给 AgentHub');
    expect(vm.fileAccept).toBe('image/*');
    expect(vm.chrome.mentionChips).toBe(true);
    expect(vm.chrome.targetPicker).toBe(true);
    expect(vm.chrome.statusStrip).toBe(true);
    expect(vm.chromeModel.mentions).toHaveLength(1);
    expect(vm.chromeModel.targetPicker?.executionTargets).toHaveLength(1);
  });

  it('builds combined host runtime + view state', () => {
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
    expect(host.view.chromeModel.mentions).toHaveLength(1);
  });

  it('reads keydown event fields and plans host keydown', () => {
    expect(readComposerKeyDownEventFields({
      key: 'Enter',
      altKey: false,
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      nativeEvent: { isComposing: false },
      currentTarget: {
        selectionStart: 1,
        selectionEnd: 1,
        value: 'ab',
      },
    })).toEqual({
      key: 'Enter',
      altKey: false,
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      isComposing: false,
      selectionStart: 1,
      selectionEnd: 1,
      currentText: 'ab',
    });

    expect(planComposerHostKeyDown({
      key: 'Enter',
      altKey: false,
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      isComposing: false,
      submitBehavior: 'enter-send',
      composerText: 'ab',
      selectionStart: 1,
      selectionEnd: 1,
      currentText: 'ab',
      attachments: [],
      isSubmitting: false,
      targetSelectionRequired: false,
      executionTargetId: '',
      isRunning: false,
    })).toEqual({ kind: 'insert-newline', nextText: 'a\nb', caret: 2 });

    expect(planComposerHostKeyDownFromEvent({
      event: {
        key: 'Enter',
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        nativeEvent: { isComposing: false },
        currentTarget: {
          selectionStart: 5,
          selectionEnd: 5,
          value: 'hello',
        },
      },
      submitBehavior: 'enter-send',
      composerText: 'hello',
      attachments: [],
      isSubmitting: false,
      targetSelectionRequired: true,
      executionTargetId: '',
      isRunning: false,
    })).toEqual({ kind: 'blocked-submit' });

    expect(composerCaretRestore(4)).toEqual({
      selectionStart: 4,
      selectionEnd: 4,
    });

    expect(planComposerHostKeyDownEffect({
      event: {
        key: 'Enter',
        altKey: false,
        shiftKey: false,
        ctrlKey: true,
        metaKey: false,
        nativeEvent: { isComposing: false },
        currentTarget: {
          selectionStart: 1,
          selectionEnd: 1,
          value: 'ab',
        },
      },
      submitBehavior: 'enter-send',
      composerText: 'ab',
      attachments: [],
      isSubmitting: false,
      targetSelectionRequired: false,
      executionTargetId: '',
      isRunning: false,
    })).toEqual({
      kind: 'insert-newline',
      textAction: { type: 'setText', text: 'a\nb' },
      caret: { selectionStart: 2, selectionEnd: 2 },
    });
  });

  it('plans mention add and attachment dispatch actions', () => {
    expect(planAddMentionAction(
      [{ id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' }],
      'missing',
    )).toBeNull();
    expect(planAddMentionAction(
      [{ id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' }],
      'profile-reviewer',
    )).toEqual({
      type: 'addMention',
      mention: { id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' },
    });

    expect(composerAttachmentAddActions([
      { id: 'a1', name: 'notes.txt', mime: 'text/plain', size: 12 },
    ])).toEqual([
      {
        type: 'addAttachment',
        attachment: { id: 'a1', name: 'notes.txt', mime: 'text/plain', size: 12 },
      },
    ]);
  });

  it('plans and resolves file pick / open-picker routes', async () => {
    expect(planComposerFilePick({
      fileList: null,
      hasNativePicker: true,
    })).toEqual({ kind: 'native' });
    expect(planComposerFilePick({
      fileList: null,
      hasNativePicker: false,
    })).toEqual({ kind: 'noop' });

    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const list = {
      0: file,
      length: 1,
      item: (index: number) => (index === 0 ? file : null),
      [Symbol.iterator]: function* iterator() {
        yield file;
      },
    } as unknown as FileList;

    expect(planComposerFilePick({
      fileList: list,
      hasNativePicker: false,
    })).toEqual({ kind: 'browser', files: [file] });

    expect(planOpenFilePicker(true)).toEqual({ kind: 'native' });
    expect(planOpenFilePicker(false)).toEqual({ kind: 'web-input' });

    const nativeAttachments = await resolveComposerFilePickAttachments({
      plan: { kind: 'native' },
      onPickLocalAttachments: async () => [{
        id: 'a1',
        name: 'desk.txt',
        mime: 'text/plain',
        size: 1,
      }],
      browserFilesToAttachments: vi.fn(async () => []),
    });
    expect(nativeAttachments).toHaveLength(1);

    const cancelled = await resolveComposerFilePickAttachments({
      plan: { kind: 'native' },
      onPickLocalAttachments: async () => {
        throw new Error('cancel');
      },
      browserFilesToAttachments: vi.fn(async () => []),
    });
    expect(cancelled).toEqual([]);

    const browserAttachments = await resolveComposerFilePickAttachments({
      plan: { kind: 'browser', files: [file] },
      browserFilesToAttachments: async (files) => files.map((entry, index) => ({
        id: `b${index}`,
        name: entry.name,
        mime: entry.type,
        size: entry.size,
      })),
    });
    expect(browserAttachments[0]?.name).toBe('a.txt');

    expect(await resolveOpenFilePickerAttachments({
      plan: { kind: 'web-input' },
    })).toBeNull();
    expect(await resolveOpenFilePickerAttachments({
      plan: { kind: 'native' },
      onPickLocalAttachments: async () => [],
    })).toEqual([]);
  });

  it('builds cancel/remove/setText composer actions', () => {
    expect(cancelReplyAction()).toEqual({ type: 'setReplyTo', replyTo: null });
    expect(cancelQuoteAction()).toEqual({ type: 'setQuote', quote: null });
    expect(removeMentionAction('m1')).toEqual({ type: 'removeMention', mentionId: 'm1' });
    expect(removeAttachmentAction('a1')).toEqual({
      type: 'removeAttachment',
      attachmentId: 'a1',
    });
    expect(setComposerTextAction('hi')).toEqual({ type: 'setText', text: 'hi' });
  });
});
