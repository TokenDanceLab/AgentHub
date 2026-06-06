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
    state = composerReducer(state, { type: 'addMention', agentId: 'builder' });
    state = composerReducer(state, { type: 'setApprovalMode', approvalMode: 'workspace-write' });
    state = composerReducer(state, { type: 'setWorkDir', workDir: '  D:\\Code\\TokenDance\\AgentHub  ' });

    expect(state).toMatchObject({
      conversationId: 'team',
      text: '请 @Builder 重构 shared shell',
      mode: 'review',
      mentions: ['builder'],
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
    state = composerReducer(state, { type: 'setSubmitState', submitState: 'submitting' });
    state = composerReducer(state, { type: 'resetAfterSubmit' });

    expect(state.text).toBe('');
    expect(state.submitState).toBe('idle');
  });
});
