// real_tested=true
import { describe, expect, it } from 'vitest';
import { cx } from './cx';

describe('cx', () => {
  it('joins multiple class names with spaces', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c');
  });

  it('filters out false, null, and undefined', () => {
    expect(cx('a', false, 'b', null, 'c', undefined)).toBe('a b c');
  });

  it('filters out empty strings', () => {
    expect(cx('a', '', 'b')).toBe('a b');
  });

  it('returns an empty string when every value is falsy', () => {
    expect(cx(false, null, undefined, '')).toBe('');
  });

  it('returns an empty string when called with no arguments', () => {
    expect(cx()).toBe('');
  });

  it('returns the single class unchanged', () => {
    expect(cx('only')).toBe('only');
  });

  it('preserves input order', () => {
    expect(cx('z', 'a', 'm')).toBe('z a m');
  });

  it('keeps duplicate classes as provided', () => {
    expect(cx('a', 'a')).toBe('a a');
  });

  it('keeps gaps where falsy values were filtered', () => {
    expect(cx('a', null, 'b', false, 'c', undefined, 'd')).toBe('a b c d');
  });
});
