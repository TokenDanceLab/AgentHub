import { describe, expect, it } from 'vitest';
import {
  auditEntryKey,
  ccSwitchConnectionTone,
  compactClassNames,
  formatModelRouteSubtitle,
  hasVisibleModelAliases,
  listCurrentCcSwitchProviders,
  listModelAliases,
  policyRiskIconName,
  resolveToolPermission,
} from './AgentOpsHelpers';
import type { CCSwitchProviderInfo } from './types';

describe('AgentOpsHelpers', () => {
  it('maps policy risk levels to DesignNavIcon names', () => {
    expect(policyRiskIconName('高风险')).toBe('policy');
    expect(policyRiskIconName('中风险')).toBe('tools');
    expect(policyRiskIconName('低风险')).toBe('tools');
  });

  it('maps cc-switch connection tones (labels moved to i18n, #2007)', () => {
    expect(ccSwitchConnectionTone(true)).toBe('active');
    expect(ccSwitchConnectionTone(false)).toBe('inactive');
  });

  it('lists model aliases while hiding *_name metadata keys', () => {
    expect(listModelAliases(undefined)).toEqual([]);
    expect(
      listModelAliases({
        default: 'claude-opus',
        default_name: 'Opus',
        fast: 'haiku',
      }),
    ).toEqual([
      ['default', 'claude-opus'],
      ['fast', 'haiku'],
    ]);
    expect(hasVisibleModelAliases({ default_name: 'Opus' })).toBe(false);
    expect(hasVisibleModelAliases({ default: 'claude-opus' })).toBe(true);
  });

  it('filters current cc-switch providers and defaults missing lists', () => {
    const providers: CCSwitchProviderInfo[] = [
      {
        providerId: 'a',
        providerName: 'A',
        appType: 'claude',
        isCurrent: true,
        isActive: true,
      },
      {
        providerId: 'b',
        providerName: 'B',
        appType: 'codex',
        isCurrent: false,
        isActive: true,
      },
    ];
    expect(listCurrentCcSwitchProviders(providers).map((p) => p.providerId)).toEqual(['a']);
    expect(listCurrentCcSwitchProviders(undefined)).toEqual([]);
  });

  it('resolves tool permissions with 需确认 fallback', () => {
    expect(resolveToolPermission({ shell: '允许' }, 'shell')).toBe('允许');
    expect(resolveToolPermission({ shell: '禁止' }, 'browser')).toBe('需确认');
    expect(resolveToolPermission(undefined, 'shell')).toBe('需确认');
    expect(resolveToolPermission({}, 'shell', '禁止')).toBe('禁止');
  });

  it('formats model route subtitles and audit keys', () => {
    expect(formatModelRouteSubtitle('Reviewer', 'plan')).toBe('Reviewer · plan');
    expect(
      auditEntryKey({ time: '10:00', agent: 'Alice', tool: 'shell' }, 2),
    ).toBe('10:00-Alice-shell-2');
  });

  it('packs className strings without undefined spreads', () => {
    expect(compactClassNames({})).toEqual({});
    expect(compactClassNames({ a: undefined, b: false, c: null })).toEqual({});
    expect(compactClassNames({ a: 'row', b: 'active', c: undefined })).toEqual({
      className: 'row active',
    });
  });
});
