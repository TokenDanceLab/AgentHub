import { afterEach, describe, expect, it } from 'vitest';
import type { ComposerMention } from './types';
import { clearDraft, loadDraft, saveDraft } from './composerDraft';

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
