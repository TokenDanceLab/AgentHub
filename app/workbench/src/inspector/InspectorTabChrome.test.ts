import { describe, expect, it } from 'vitest';
import {
  defaultVisibleTabs,
  getInspectorTabs,
  getQuickOpenItems,
  inspectorTabLabel,
} from './InspectorTabChrome';

describe('InspectorTabChrome', () => {
  const t = (key: string) => key;

  it('exposes the three residual inspector modes', () => {
    expect(getInspectorTabs(t).map((tab) => tab.mode)).toEqual([
      'overview',
      'browser',
      'files',
    ]);
    /* P76: default primary card is overview only; browser/files open on demand. */
    expect([...defaultVisibleTabs]).toEqual(['overview']);
  });

  it('labels tabs through the same i18n keys as before', () => {
    expect(inspectorTabLabel('overview', t)).toBe('inspector.overview');
    expect(inspectorTabLabel('browser', t)).toBe('inspector.browser');
    expect(inspectorTabLabel('files', t)).toBe('inspector.files');
  });

  it('keeps quick-open mode targets stable (#1822: dead chat/terminal entries removed)', () => {
    expect(getQuickOpenItems(t).map((item) => [item.id, item.mode])).toEqual([
      ['files', 'files'],
      ['browser', 'browser'],
    ]);
    // Only files keeps a shortcut claim — Ctrl+P is registered by the
    // workbench dispatcher. Ctrl+T/Ctrl+` labels removed (#1822).
    expect(getQuickOpenItems(t).map((item) => item.shortcut)).toEqual(['Ctrl+P', '']);
  });
});
