import { describe, expect, it } from 'vitest';
import type { ComposerMention } from '@shared/composer';
import {
  detectMentionTrigger,
  filterMentionCandidates,
  removeMentionTriggerText,
} from './composerMentionTrigger';

const agents: ComposerMention[] = [
  { id: 'builder', label: 'Builder', runtimeId: 'claude-code' },
  { id: 'reviewer', label: 'Reviewer', runtimeId: 'codex' },
  { id: 'orchestrator', label: 'Orchestrator', runtimeId: 'opencode' },
];

describe('detectMentionTrigger', () => {
  it.each([
    ['@', 1, { atOffset: 0, query: '', caret: 1 }],
    ['hi @rev', 7, { atOffset: 3, query: 'rev', caret: 7 }],
    ['hello\n@or', 9, { atOffset: 6, query: 'or', caret: 9 }],
    ['@a @b', 5, { atOffset: 3, query: 'b', caret: 5 }],
    ['@rev', 999, { atOffset: 0, query: 'rev', caret: 4 }],
  ])('detects the trigger in %s at caret %s', (text, caret, expected) => {
    expect(detectMentionTrigger({ text, caret })).toEqual(expected);
  });

  it.each([
    ['foo@bar', 7],
    ['hi @rev world', 14],
    ['no mention here', 15],
  ])('returns null for %s at caret %s', (text, caret) => {
    expect(detectMentionTrigger({ text, caret })).toBeNull();
  });
});

describe('filterMentionCandidates', () => {
  it('returns all candidates when the query is empty', () => {
    expect(filterMentionCandidates({ candidates: agents, query: '' })).toHaveLength(3);
  });

  it('ranks prefix matches before substring matches', () => {
    // "or" prefixes Orchestrator and is contained in neither Builder nor Reviewer.
    const result = filterMentionCandidates({ candidates: agents, query: 'or' });
    expect(result.map((m) => m.id)).toEqual(['orchestrator']);
  });

  it('matches case-insensitively', () => {
    const result = filterMentionCandidates({ candidates: agents, query: 'BUI' });
    expect(result.map((m) => m.id)).toEqual(['builder']);
  });

  it('keeps substring (non-prefix) matches after prefix matches', () => {
    const mixed: ComposerMention[] = [
      { id: 'a', label: 'Reviewer' }, // contains "view"
      { id: 'b', label: 'view-only' }, // prefix
    ];
    const result = filterMentionCandidates({ candidates: mixed, query: 'view' });
    expect(result.map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterMentionCandidates({ candidates: agents, query: 'zzz' })).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input: ComposerMention[] = [agents[0]!];
    filterMentionCandidates({ candidates: input, query: 'bui' });
    expect(input).toHaveLength(1);
  });
});

describe('removeMentionTriggerText', () => {
  it('strips the "@" + query segment and lands the caret at the start', () => {
    expect(removeMentionTriggerText({ text: 'hi @rev rest', atOffset: 3, caret: 7 })).toEqual({
      nextText: 'hi  rest',
      nextCaret: 3,
    });
  });

  it('removes the trigger at the start of the text', () => {
    expect(removeMentionTriggerText({ text: '@rev rest', atOffset: 0, caret: 4 })).toEqual({
      nextText: ' rest',
      nextCaret: 0,
    });
  });

  it('clamps caret beyond text length', () => {
    expect(removeMentionTriggerText({ text: '@rev', atOffset: 0, caret: 999 })).toEqual({
      nextText: '',
      nextCaret: 0,
    });
  });
});
