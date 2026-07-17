import { describe, expect, it } from 'vitest';
import {
  STATE_PREVIEW_SPECS,
  dataModeStatusDetail,
  dataModeStatusLabel,
  formatLocalCliItemDescription,
  formatLocalCliItemValue,
  joinClassNames,
  resolvePermissionValue,
  statePanelIconName,
  statePanelKindClassName,
} from './SettingsPaneHelpers';

describe('SettingsPaneHelpers', () => {
  it('labels data-mode status heads by contract mode', () => {
    expect(dataModeStatusLabel('auto')).toBe('Auto fallback');
    expect(dataModeStatusLabel('approved-real')).toBe('Approved real');
    expect(dataModeStatusLabel('real')).toBe('Approved real');
    expect(dataModeStatusLabel('mock')).toBe('Mock data');
    expect(dataModeStatusLabel('fixture')).toBe('Fixture data');
    expect(dataModeStatusLabel('observed')).toBe('Observed data');
  });

  it('exposes shared data-mode contract fields for the status panel', () => {
    expect(dataModeStatusDetail('mock')).toMatchObject({
      mode: 'mock',
      displayLabel: 'Mock',
      desktopLabel: '5173: demo transcript',
      webLabel: '5174: demo transcript',
    });
  });

  it('formats local CLI discovery row description and value', () => {
    expect(
      formatLocalCliItemDescription({ version: '1.2.3', path: '/usr/bin/claude' }),
    ).toBe('version 1.2.3 · /usr/bin/claude');
    expect(
      formatLocalCliItemDescription({ version: null, path: 'C:\\tools\\codex.exe' }),
    ).toBe('version unknown · C:\\tools\\codex.exe');

    expect(formatLocalCliItemValue({ installed: true, noSpend: true })).toBe(
      'installed · no-spend',
    );
    expect(formatLocalCliItemValue({ installed: false, noSpend: false })).toBe(
      'missing · requires approval',
    );
  });

  it('maps state-panel icons and kind class names safely', () => {
    expect(statePanelIconName('empty')).toBe('inbox');
    expect(statePanelIconName('invalid')).toBe('lock');
    expect(statePanelIconName('missing')).toBe('error404');

    expect(
      statePanelKindClassName('empty', {
        statePanelEmpty: 'empty-cls',
        statePanelInvalid: 'invalid-cls',
        statePanelMissing: 'missing-cls',
      }),
    ).toBe('empty-cls');
    expect(
      statePanelKindClassName('invalid', {
        statePanelEmpty: 'empty-cls',
        statePanelInvalid: 'invalid-cls',
        statePanelMissing: 'missing-cls',
      }),
    ).toBe('invalid-cls');
    expect(statePanelKindClassName('missing', {})).toBe('');
  });

  it('joins class names without empty/false parts', () => {
    expect(joinClassNames('a', undefined, null, false, 'b', '')).toBe('a b');
    expect(joinClassNames()).toBe('');
  });

  it('lists three state preview specs with stable action keys', () => {
    expect(STATE_PREVIEW_SPECS).toHaveLength(3);
    expect(STATE_PREVIEW_SPECS.map((s) => s.kind)).toEqual(['empty', 'invalid', 'missing']);
    expect(STATE_PREVIEW_SPECS.map((s) => s.actionKey)).toEqual([
      'action_state_empty',
      'action_state_invalid',
      'action_state_missing',
    ]);
  });

  it('resolves permission values with props override then row default', () => {
    expect(resolvePermissionValue({ Read: '禁止' }, 'Read', '允许')).toBe('禁止');
    expect(resolvePermissionValue({}, 'Write', '需确认')).toBe('需确认');
  });
});
