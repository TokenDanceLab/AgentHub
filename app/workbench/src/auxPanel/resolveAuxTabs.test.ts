import { describe, expect, it } from 'vitest';
import {
  isFolderScopedAuxTab,
  resolveAvailableAuxTabs,
  resolveEffectiveAuxTab,
} from './resolveAuxTabs';

describe('resolveAvailableAuxTabs (#1172)', () => {
  it('session-only without workspace', () => {
    expect(resolveAvailableAuxTabs({ hasWorkspace: false })).toEqual(['session_details']);
  });

  it('session-only when localFiles false even with workspace', () => {
    expect(resolveAvailableAuxTabs({ hasWorkspace: true, localFiles: false })).toEqual([
      'session_details',
    ]);
  });

  it('exposes preview without local file capability when runtime evidence exists', () => {
    expect(resolveAvailableAuxTabs({ hasWorkspace: false, localFiles: false, previewAvailable: true })).toEqual([
      'preview',
    ]);
  });

  it('full tab order with workspace + localFiles', () => {
    expect(resolveAvailableAuxTabs({ hasWorkspace: true, localFiles: true })).toEqual([
      'session_details',
      'file_tree',
      'changes',
      'git_log',
    ]);
  });

  it('places preview beside the engineering tabs when enabled', () => {
    expect(resolveAvailableAuxTabs({ hasWorkspace: true, localFiles: true, previewAvailable: true })).toEqual([
      'session_details',
      'file_tree',
      'changes',
      'preview',
      'git_log',
    ]);
  });
});

describe('resolveEffectiveAuxTab (#1172)', () => {
  it('keeps active when still available', () => {
    expect(resolveEffectiveAuxTab('changes', ['session_details', 'changes'])).toBe('changes');
  });

  it('falls back when active becomes unavailable', () => {
    expect(resolveEffectiveAuxTab('file_tree', ['session_details'])).toBe('session_details');
  });
});

describe('isFolderScopedAuxTab', () => {
  it('classifies folder tabs', () => {
    expect(isFolderScopedAuxTab('file_tree')).toBe(true);
    expect(isFolderScopedAuxTab('session_details')).toBe(false);
  });
});
