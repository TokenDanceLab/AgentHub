import { describe, expect, it } from 'vitest';
import { resolveTopMenuClickState } from '@/utils/topMenuState';

describe('top menu state', () => {
  it('opens a closed menu on click', () => {
    expect(resolveTopMenuClickState(null, 'file', null)).toBe('file');
  });

  it('closes the currently open menu on a repeated direct click', () => {
    expect(resolveTopMenuClickState('file', 'file', null)).toBeNull();
  });

  it('keeps a hover-switched menu open when the click lands on that menu', () => {
    expect(resolveTopMenuClickState('edit', 'edit', 'edit')).toBe('edit');
  });

  it('switches to a different clicked menu', () => {
    expect(resolveTopMenuClickState('file', 'window', null)).toBe('window');
  });
});
