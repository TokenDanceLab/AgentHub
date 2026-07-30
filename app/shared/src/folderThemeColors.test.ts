import { afterEach, describe, expect, it } from 'vitest';
import {
  FOLDER_THEME_COLORS,
  FOLDER_THEME_COLOR_META,
  applyFolderThemeColor,
  getFolderThemeColorMeta,
  isFolderThemeColor,
  type FolderThemeColor,
} from './folderThemeColors';

describe('folderThemeColors SSOT', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-folder-accent');
  });

  it('lists 8 folder accent colors with distinct hues for visual partitioning', () => {
    expect(FOLDER_THEME_COLORS).toEqual([
      'plum',
      'blue',
      'emerald',
      'amber',
      'rose',
      'violet',
      'cyan',
      'orange',
    ]);
    expect(FOLDER_THEME_COLORS.length).toBe(8);
  });

  it('exposes complete light/dark variant metadata for every palette entry', () => {
    for (const key of FOLDER_THEME_COLORS) {
      const meta = FOLDER_THEME_COLOR_META[key];
      expect(meta).toBeDefined();
      expect(meta.label).toBeTruthy();
      // Light/dark accent fills must be distinct hex colors
      expect(meta.light).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(meta.dark).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(meta.light).not.toBe(meta.dark);
      // Foreground readable on each fill
      expect(meta.lightForeground).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(meta.darkForeground).toMatch(/^#[0-9a-fA-F]{6}$/);
      // Soft tint + ring rgba variants present
      expect(meta.lightSoft).toContain('rgba(');
      expect(meta.darkSoft).toContain('rgba(');
      expect(meta.lightRing).toContain('rgba(');
      expect(meta.darkRing).toContain('rgba(');
    }
  });

  it('uses distinct accent fills across the palette (no two folders share a hue)', () => {
    const lights = FOLDER_THEME_COLORS.map((k) => FOLDER_THEME_COLOR_META[k].light);
    const darks = FOLDER_THEME_COLORS.map((k) => FOLDER_THEME_COLOR_META[k].dark);
    expect(new Set(lights).size).toBe(lights.length);
    expect(new Set(darks).size).toBe(darks.length);
  });

  it('validates folder theme color keys', () => {
    expect(isFolderThemeColor('plum')).toBe(true);
    expect(isFolderThemeColor('emerald')).toBe(true);
    expect(isFolderThemeColor('not-a-color')).toBe(false);
    expect(isFolderThemeColor(null)).toBe(false);
    expect(isFolderThemeColor(undefined)).toBe(false);
  });

  it('looks up metadata by key', () => {
    const meta = getFolderThemeColorMeta('rose');
    expect(meta.label).toBe('Rose');
    expect(meta.light).toBe('#e11d48');
    expect(meta.dark).toBe('#fb7185');
  });

  it('applies data-folder-accent on the document element', () => {
    applyFolderThemeColor('emerald');
    expect(document.documentElement.getAttribute('data-folder-accent')).toBe('emerald');

    applyFolderThemeColor('violet');
    expect(document.documentElement.getAttribute('data-folder-accent')).toBe('violet');
  });

  it('clears data-folder-accent when passed undefined (reverts to default)', () => {
    applyFolderThemeColor('amber');
    expect(document.documentElement.hasAttribute('data-folder-accent')).toBe(true);

    applyFolderThemeColor(undefined);
    expect(document.documentElement.hasAttribute('data-folder-accent')).toBe(false);
  });

  it('is type-narrowed by isFolderThemeColor', () => {
    const input: string | null = 'cyan';
    if (isFolderThemeColor(input)) {
      // compiler proves the narrowing
      const _narrowed: FolderThemeColor = input;
      expect(_narrowed).toBe('cyan');
    } else {
      throw new Error('should have narrowed');
    }
  });
});
