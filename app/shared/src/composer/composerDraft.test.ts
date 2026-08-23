import { afterEach, describe, expect, it } from 'vitest';
import type { ComposerMention } from './types';
import { clearDraft, loadDraft, saveDraft, serializeDraft } from './composerDraft';

const SESSION_A = 'hub-session-aaa';
const SESSION_B = 'hub-session-bbb';

const sampleMentions: ComposerMention[] = [
  { id: 'agent-alice', label: 'Alice', runtimeId: 'claude-code', dispatchRole: 'dispatch' },
  { id: 'agent-bob', label: 'Bob' },
];

afterEach(() => {
  localStorage.clear();
});

describe('saveDraft / loadDraft', () => {
  it('saves and loads text + mentions for a session', () => {
    saveDraft(SESSION_A, { text: 'Hello world', mentions: sampleMentions });
    const loaded = loadDraft(SESSION_A);
    expect(loaded).toEqual({ text: 'Hello world', mentions: sampleMentions });
  });

  it('returns null when no draft exists for the session', () => {
    expect(loadDraft(SESSION_A)).toBeNull();
  });

  it('isolates drafts by sessionId', () => {
    saveDraft(SESSION_A, { text: 'Session A', mentions: [] });
    saveDraft(SESSION_B, { text: 'Session B', mentions: sampleMentions });
    expect(loadDraft(SESSION_A)).toEqual({ text: 'Session A', mentions: [] });
    expect(loadDraft(SESSION_B)).toEqual({ text: 'Session B', mentions: sampleMentions });
  });

  it('handles empty text and mentions', () => {
    saveDraft(SESSION_A, { text: '', mentions: [] });
    expect(loadDraft(SESSION_A)).toEqual({ text: '', mentions: [] });
  });

  it('stores mentions with minimal fields', () => {
    const minimalMentions: ComposerMention[] = [{ id: 'x', label: 'X' }];
    saveDraft(SESSION_A, { text: 'hi', mentions: minimalMentions });
    expect(loadDraft(SESSION_A)?.mentions).toEqual(minimalMentions);
  });

  it('overwrites an existing draft on subsequent save', () => {
    saveDraft(SESSION_A, { text: 'v1', mentions: [] });
    saveDraft(SESSION_A, { text: 'v2', mentions: sampleMentions });
    const loaded = loadDraft(SESSION_A);
    expect(loaded?.text).toBe('v2');
    expect(loaded?.mentions).toHaveLength(2);
  });
});

describe('clearDraft', () => {
  it('removes the draft for the given session', () => {
    saveDraft(SESSION_A, { text: 'keep me', mentions: [] });
    saveDraft(SESSION_B, { text: 'delete me', mentions: [] });
    clearDraft(SESSION_B);
    expect(loadDraft(SESSION_A)).toEqual({ text: 'keep me', mentions: [] });
    expect(loadDraft(SESSION_B)).toBeNull();
  });

  it('is idempotent — no error when no draft exists', () => {
    expect(() => clearDraft('nonexistent-session')).not.toThrow();
  });
});

describe('loadDraft validation', () => {
  function setRaw(key: string, raw: string): void {
    localStorage.setItem(`agenthub.composer.draft.${key}`, raw);
  }

  it('returns null for malformed JSON', () => {
    setRaw(SESSION_A, '{invalid json');
    expect(loadDraft(SESSION_A)).toBeNull();
  });

  it('returns null when text is not a string', () => {
    setRaw(SESSION_A, JSON.stringify({ text: 42, mentions: [] }));
    expect(loadDraft(SESSION_A)).toBeNull();
  });

  it('returns null when mentions is not an array', () => {
    setRaw(SESSION_A, JSON.stringify({ text: 'hi', mentions: 'not-array' }));
    expect(loadDraft(SESSION_A)).toBeNull();
  });

  it('returns null when a mention lacks id', () => {
    setRaw(SESSION_A, JSON.stringify({ text: 'hi', mentions: [{ label: 'NoId' }] }));
    expect(loadDraft(SESSION_A)).toBeNull();
  });

  it('returns null when a mention lacks label', () => {
    setRaw(SESSION_A, JSON.stringify({ text: 'hi', mentions: [{ id: 'no-label' }] }));
    expect(loadDraft(SESSION_A)).toBeNull();
  });

  it('returns null when a mention item is not an object', () => {
    setRaw(SESSION_A, JSON.stringify({ text: 'hi', mentions: ['string-item'] }));
    expect(loadDraft(SESSION_A)).toBeNull();
  });
});

describe('localStorage key format', () => {
  it('uses the agenthub.composer.draft. prefix', () => {
    saveDraft(SESSION_A, { text: 'test', mentions: [] });
    expect(localStorage.getItem('agenthub.composer.draft.hub-session-aaa')).toBeTruthy();
  });
});

describe('#1822 serialized draft payloads (attachments / reply / quote)', () => {
  const attachmentRef = {
    id: 'att-1', name: 'design.pdf', size: 1024, mime_type: 'application/pdf', url: '/files/1',
  };

  it('round-trips reply/quote and ref-bearing attachments via serializeDraft', () => {
    const draft = serializeDraft({
      text: 'quote reply',
      mentions: [],
      attachments: [{ id: 'a1', name: 'design.pdf', size: 1024, mime: 'application/pdf', attachmentRef }],
      replyTo: { messageId: 'msg-1', author: 'Alice', preview: '答案在…' },
      quote: { text: '引用的原句', author: 'Bob', messageId: 'msg-2' },
    });
    expect(draft.attachments).toEqual([{ id: 'a1', name: 'design.pdf', size: 1024, mime: 'application/pdf', attachmentRef }]);
    saveDraft(SESSION_A, draft);
    const loaded = loadDraft(SESSION_A);
    expect(loaded?.text).toBe('quote reply');
    expect(loaded?.replyTo).toEqual({ messageId: 'msg-1', author: 'Alice', preview: '答案在…' });
    expect(loaded?.quote).toEqual({ text: '引用的原句', author: 'Bob', messageId: 'msg-2' });
    expect(loaded?.attachments?.[0]?.attachmentRef).toEqual(attachmentRef);
  });

  it('drops in-flight attachments (no ref) from the serialized payload', () => {
    const draft = serializeDraft({
      text: 'x',
      mentions: [],
      attachments: [
        { id: 'a1', name: 'design.pdf', size: 1024, attachmentRef },
        { id: 'a2', name: 'pending.png', size: 2048, file: new File([''], 'pending.png') },
      ],
    });
    expect(draft.attachments).toHaveLength(1);
    expect(draft.attachments![0]!.id).toBe('a1');
  });

  it('omits optional keys when absent (backward compatibility with legacy drafts)', () => {
    const draft = serializeDraft({ text: 'plain', mentions: [] });
    expect(draft).toEqual({ text: 'plain', mentions: [] });
    saveDraft(SESSION_A, draft);
    expect(loadDraft(SESSION_A)).toEqual({ text: 'plain', mentions: [] });
  });

  it('rejects malformed attachment refs on load', () => {
    localStorage.setItem(
      `agenthub.composer.draft.${SESSION_A}`,
      JSON.stringify({ text: 'x', mentions: [], attachments: [{ id: 'a1', name: 'n' }] }),
    );
    expect(loadDraft(SESSION_A)).toBeNull();
  });

  it('#1853 review: rejects refs missing the required mime_type', () => {
    localStorage.setItem(
      `agenthub.composer.draft.${SESSION_A}`,
      JSON.stringify({
        text: 'x',
        mentions: [],
        attachments: [{
          id: 'a1',
          name: 'design.pdf',
          attachmentRef: { id: 'att-1', name: 'design.pdf', size: 1024 },
        }],
      }),
    );
    expect(loadDraft(SESSION_A)).toBeNull();
  });

  it('accepts valid replyTo/quote shapes and rejects broken ones', () => {
    const valid = { text: 't', mentions: [], replyTo: { messageId: 'm', author: 'a', preview: 'p' } };
    saveDraft(SESSION_A, valid);
    expect(loadDraft(SESSION_A)?.replyTo).toEqual(valid.replyTo);

    localStorage.setItem(
      `agenthub.composer.draft.${SESSION_A}`,
      JSON.stringify({ text: 't', mentions: [], quote: { author: 'no text' } }),
    );
    expect(loadDraft(SESSION_A)).toBeNull();
  });
});
