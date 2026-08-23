import { describe, expect, it } from 'vitest';
import {
  buildComposerIntent,
  canSubmitComposer,
  captureComposerDraft,
  composerReducer,
  createInitialComposerState,
} from './composerReducer';

describe('composerReducer', () => {
  it('tracks text, mode, mentions and approval mode for a conversation', () => {
    let state = createInitialComposerState('team');

    state = composerReducer(state, { type: 'setText', text: '请 @Builder 重构 shared shell' });
    state = composerReducer(state, { type: 'setMode', mode: 'review' });
    state = composerReducer(state, {
      type: 'addMention',
      mention: { id: 'builder', label: 'Builder', model: 'glm-5.1' },
    });
    state = composerReducer(state, { type: 'setApprovalMode', approvalMode: 'workspace-write' });
    state = composerReducer(state, { type: 'setWorkDir', workDir: '  D:\\Code\\TokenDance\\AgentHub  ' });

    expect(state).toMatchObject({
      conversationId: 'team',
      text: '请 @Builder 重构 shared shell',
      mode: 'review',
      mentions: [{ id: 'builder', label: 'Builder', model: 'glm-5.1' }],
      approvalMode: 'workspace-write',
      workDir: '  D:\\Code\\TokenDance\\AgentHub  ',
    });
  });

  it('supports the v4 composer modes from the design shell', () => {
    const initial = createInitialComposerState('team');
    const modes = ['ask', 'plan', 'code', 'review', 'deploy'] as const;

    for (const mode of modes) {
      expect(composerReducer(initial, { type: 'setMode', mode }).mode).toBe(mode);
    }
  });

  it('only submits non-empty text or attachments and builds a platform intent', () => {
    const empty = createInitialComposerState('team');
    expect(canSubmitComposer(empty)).toBe(false);

    const withAttachment = composerReducer(empty, {
      type: 'addAttachment',
      attachment: { id: 'attachment-1', name: 'notes.txt', source: 'browser' },
    });
    expect(canSubmitComposer(withAttachment)).toBe(true);

    const ready = composerReducer(empty, { type: 'setText', text: '  build v4  ' });
    expect(canSubmitComposer(ready)).toBe(true);
    expect(buildComposerIntent(ready)).toEqual(
      expect.objectContaining({
        conversationId: 'team',
        text: 'build v4',
        mode: 'ask',
        approvalMode: 'suggest',
      }),
    );

    const withWorkDir = composerReducer(ready, { type: 'setWorkDir', workDir: ' D:\\Code\\TokenDance\\AgentHub ' });
    expect(buildComposerIntent(withWorkDir)).toEqual(
      expect.objectContaining({
        workDir: 'D:\\Code\\TokenDance\\AgentHub',
      }),
    );
  });

  it('prepends quote text into the existing draft instead of replacing it (#1821)', () => {
    const empty = createInitialComposerState('team');
    const quotedEmpty = composerReducer(empty, { type: 'prependText', text: '> 引用\n\n' });
    expect(quotedEmpty.text).toBe('> 引用\n\n');

    const withDraft = composerReducer(
      { ...quotedEmpty, text: '> 引用\n\n正在写的草稿' },
      { type: 'prependText', text: '> 第二条引用\n\n' },
    );
    expect(withDraft.text).toBe('> 第二条引用\n\n> 引用\n\n正在写的草稿');
  });

  it('restores a captured draft after a failed submit (#1821)', () => {
    let state = createInitialComposerState('team');
    state = composerReducer(state, { type: 'setText', text: '附带内容的草稿' });
    state = composerReducer(state, {
      type: 'addMention',
      mention: { id: 'builder', label: 'Builder' },
    });
    state = composerReducer(state, {
      type: 'addAttachment',
      attachment: { id: 'a1', name: 'notes.md', source: 'browser' },
    });
    state = composerReducer(state, {
      type: 'setReplyTo',
      replyTo: { messageId: 'm1', author: 'You', preview: 'preview' },
    });
    const snapshot = {
      text: state.text,
      mentions: [...state.mentions],
      attachments: [...state.attachments],
      replyTo: state.replyTo,
      quote: null,
    };

    // Optimistic clear (what a submit does), then restore on failure.
    const cleared = composerReducer(state, { type: 'resetAfterSubmit' });
    expect(cleared.text).toBe('');
    expect(cleared.attachments).toEqual([]);

    const restored = composerReducer(cleared, { type: 'restoreDraft', draft: snapshot });
    expect(restored.text).toBe('附带内容的草稿');
    expect(restored.mentions.map((m) => m.id)).toEqual(['builder']);
    expect(restored.attachments.map((a) => a.id)).toEqual(['a1']);
    expect(restored.replyTo?.messageId).toBe('m1');
  });

  it('writes upload refs back into attachments and keeps them across restore (#1821)', () => {
    let state = createInitialComposerState('team');
    state = composerReducer(state, {
      type: 'addAttachment',
      attachment: { id: 'a1', name: 'notes.md', source: 'browser', file: new File(['x'], 'notes.md') },
    });
    state = composerReducer(state, {
      type: 'setAttachmentRef',
      attachmentId: 'a1',
      attachmentRef: { id: 'att-1', name: 'notes.md', size: 1, mime_type: 'text/markdown' },
    });
    expect(state.attachments[0]?.attachmentRef?.id).toBe('att-1');
  });

  it('resets text and transient submit state after successful submit', () => {
    let state = composerReducer(createInitialComposerState('team'), { type: 'setText', text: 'ship' });
    state = composerReducer(state, { type: 'addMention', mention: { id: 'builder', label: 'Builder' } });
    state = composerReducer(state, { type: 'setSubmitState', submitState: 'submitting' });
    state = composerReducer(state, { type: 'resetAfterSubmit' });

    expect(state.text).toBe('');
    expect(state.mentions).toEqual([]);
    expect(state.submitState).toBe('idle');
  });

  it('enters edit mode for an already-sent message and carries the id in the intent', () => {
    const base = composerReducer(createInitialComposerState('team'), { type: 'setText', text: 'draft' });
    const editing = composerReducer(base, { type: 'setEditingMessage', messageId: 'hub-message-42' });
    expect(editing.editingMessageId).toBe('hub-message-42');
    expect(buildComposerIntent(editing).editingMessageId).toBe('hub-message-42');

    const cleared = composerReducer(editing, { type: 'setEditingMessage', messageId: null });
    expect(cleared.editingMessageId).toBeNull();
    expect(buildComposerIntent(cleared).editingMessageId).toBeUndefined();
  });

  it('clears the edit context on submit reset and on conversation switch', () => {
    const editing = composerReducer(
      composerReducer(createInitialComposerState('team'), { type: 'setEditingMessage', messageId: 'hub-message-42' }),
      { type: 'setText', text: 'edited' },
    );
    expect(editing.editingMessageId).toBe('hub-message-42');

    const afterReset = composerReducer(editing, { type: 'resetAfterSubmit' });
    expect(afterReset.editingMessageId).toBeNull();
    expect(afterReset.text).toBe('');

    const reEdit = composerReducer(afterReset, { type: 'setEditingMessage', messageId: 'hub-message-42' });
    const afterSwitch = composerReducer(reEdit, { type: 'setConversationId', conversationId: 'other' });
    expect(afterSwitch.editingMessageId).toBeNull();
  });

  it('restores idle submit chrome when entering edit mode from an error state', () => {
    const errored = composerReducer(createInitialComposerState('team'), { type: 'setSubmitState', submitState: 'error' });
    const editing = composerReducer(errored, { type: 'setEditingMessage', messageId: 'hub-message-1' });
    expect(editing.submitState).toBe('idle');
  });

  it('dedupes mentions and attachments by id', () => {
    const mention = { id: 'builder', label: 'Builder' };
    const withMention = composerReducer(createInitialComposerState('team'), { type: 'addMention', mention });
    const dupMention = composerReducer(withMention, { type: 'addMention', mention });
    expect(dupMention).toBe(withMention);
    expect(dupMention.mentions).toHaveLength(1);

    const attachment = { id: 'a1', name: 'x.txt', source: 'browser' as const };
    const withAttachment = composerReducer(withMention, { type: 'addAttachment', attachment });
    const dupAttachment = composerReducer(withAttachment, { type: 'addAttachment', attachment });
    expect(dupAttachment).toBe(withAttachment);
    expect(dupAttachment.attachments).toHaveLength(1);
  });

  it('removes mentions and attachments by id', () => {
    let state = composerReducer(createInitialComposerState('team'), {
      type: 'addMention',
      mention: { id: 'builder', label: 'Builder' },
    });
    state = composerReducer(state, {
      type: 'addAttachment',
      attachment: { id: 'a1', name: 'x.txt', source: 'browser' },
    });

    const withoutMention = composerReducer(state, { type: 'removeMention', mentionId: 'builder' });
    expect(withoutMention.mentions).toEqual([]);
    expect(withoutMention.attachments).toHaveLength(1);

    const withoutAttachment = composerReducer(state, { type: 'removeAttachment', attachmentId: 'a1' });
    expect(withoutAttachment.attachments).toEqual([]);
    expect(withoutAttachment.mentions).toHaveLength(1);

    // Removing an unknown id is a no-op on the collection contents.
    expect(composerReducer(state, { type: 'removeMention', mentionId: 'ghost' }).mentions).toHaveLength(1);
  });

  it('stores a quote and carries replyTo/quote through the submit intent', () => {
    let state = composerReducer(createInitialComposerState('team'), { type: 'setText', text: 'reply body' });
    state = composerReducer(state, {
      type: 'setReplyTo',
      replyTo: { messageId: 'm9', author: 'Ada', preview: 'earlier' },
    });
    state = composerReducer(state, { type: 'setQuote', quote: { text: 'quoted passage', author: 'Ada' } });

    expect(state.replyTo?.messageId).toBe('m9');
    expect(state.quote).toEqual({ text: 'quoted passage', author: 'Ada' });
    expect(buildComposerIntent(state)).toEqual(
      expect.objectContaining({
        replyTo: { messageId: 'm9', author: 'Ada', preview: 'earlier' },
        quote: { text: 'quoted passage', author: 'Ada' },
      }),
    );

    const cleared = composerReducer(state, { type: 'setQuote', quote: null });
    expect(cleared.quote).toBeNull();
    expect(buildComposerIntent(cleared).quote).toBeUndefined();
  });

  it('leaves unrelated attachments untouched when setting an attachment ref', () => {
    let state = composerReducer(createInitialComposerState('team'), {
      type: 'addAttachment',
      attachment: { id: 'a1', name: 'x.txt', source: 'browser' },
    });
    state = composerReducer(state, {
      type: 'addAttachment',
      attachment: { id: 'a2', name: 'y.txt', source: 'browser' },
    });
    state = composerReducer(state, {
      type: 'setAttachmentRef',
      attachmentId: 'a1',
      attachmentRef: { id: 'ref-1', name: 'x.txt', size: 1, mime_type: 'text/plain' },
    });
    expect(state.attachments.find((a) => a.id === 'a1')?.attachmentRef?.id).toBe('ref-1');
    expect(state.attachments.find((a) => a.id === 'a2')?.attachmentRef).toBeUndefined();
  });

  it('returns the same state reference for unknown actions', () => {
    const state = createInitialComposerState('team');
    const next = composerReducer(state, { type: 'not.a.real.action' } as unknown as Parameters<typeof composerReducer>[1]);
    expect(next).toBe(state);
  });

  it('captures a draft snapshot with optional text override for failed-send restore', () => {
    let state = composerReducer(createInitialComposerState('team'), { type: 'setText', text: '原始内容' });
    state = composerReducer(state, { type: 'addMention', mention: { id: 'builder', label: 'Builder' } });
    state = composerReducer(state, {
      type: 'addAttachment',
      attachment: { id: 'a1', name: 'x.txt', source: 'browser' },
    });
    state = composerReducer(state, { type: 'setQuote', quote: { text: '引用' } });

    const snapshot = captureComposerDraft(state);
    expect(snapshot).toEqual({
      text: '原始内容',
      mentions: state.mentions,
      attachments: state.attachments,
      replyTo: null,
      quote: { text: '引用' },
    });

    const overridden = captureComposerDraft(state, { text: '替换后的内容' });
    expect(overridden.text).toBe('替换后的内容');
    expect(overridden.mentions).toEqual(state.mentions);
  });
});
