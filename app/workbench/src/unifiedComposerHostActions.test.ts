import { describe, expect, it, vi } from 'vitest';
import {
  cancelQuoteAction,
  cancelReplyAction,
  composerAttachmentAddActions,
  dispatchComposerAttachmentAdds,
  planAddMentionAction,
  removeAttachmentAction,
  removeMentionAction,
  setComposerTextAction,
} from './unifiedComposerHostActions';

describe('unifiedComposerHostActions', () => {
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

  it('dispatches attachment-add actions through the provided dispatcher', () => {
    const dispatch = vi.fn();
    dispatchComposerAttachmentAdds(dispatch, [
      { id: 'a1', name: 'notes.txt', mime: 'text/plain', size: 12 },
      { id: 'a2', name: 'img.png', mime: 'image/png', size: 20 },
    ]);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: 'addAttachment',
      attachment: { id: 'a1', name: 'notes.txt', mime: 'text/plain', size: 12 },
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'addAttachment',
      attachment: { id: 'a2', name: 'img.png', mime: 'image/png', size: 20 },
    });
  });
});
