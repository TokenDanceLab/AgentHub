import { describe, expect, it } from 'vitest';
import {
  buildComposerIntent,
  canSubmitComposer,
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
});
