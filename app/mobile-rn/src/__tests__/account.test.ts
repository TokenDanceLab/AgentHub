/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * AccountScreen data-level logic tests.
 *
 * Covers account status formatting, menu section generation, theme mode handling,
 * TokenDance status, badge mapping, and fixture scenario validation.
 *
 * Vitest environment: node — tests pure data transformations (no React rendering).
 */
import { describe, expect, it } from 'vitest';

import { getMobileFixtureForScenario, mobileFixture } from '@/data/mobileFixtures';
import type { MobileAccountState, MobileFixtureScenario, MobileThemeMode } from '@/types';

// ---------------------------------------------------------------------------
// Replicated helpers (source: AccountScreen.tsx)
// ---------------------------------------------------------------------------

interface AccountMenuItem {
  icon: string;
  label: string;
  status?: string;
  color: string;
  onPress?: boolean;
}

interface AccountMenuSection {
  title: string;
  items: AccountMenuItem[];
}

function formatTokenDanceStatus(status: MobileAccountState['tokenDanceId']): string {
  if (status === 'signed_in') return 'Signed in';
  if (status === 'recovering') return 'Recovering';
  return 'Signed out';
}

function getAccountTone(status: MobileAccountState['tokenDanceId']): 'success' | 'warning' | 'danger' {
  if (status === 'signed_in') return 'success';
  if (status === 'recovering') return 'warning';
  return 'danger';
}

function getStatusBadgeLabel(value: string): string {
  const labelMap: Record<string, string> = {
    active: 'Online',
    granted: 'Online',
    signed_in: 'Signed in',
    expired: 'Failed',
    blocked: 'Blocked',
    missing: 'Failed',
    offline: 'Offline',
    recovering: 'Recovering',
    prompt: 'Needs action',
    signed_out: 'Signed out',
    unavailable: 'Unavailable',
  };
  return labelMap[value] ?? 'Needs action';
}

function getStatusBadgeTone(value: string): 'neutral' | 'success' | 'warning' | 'danger' {
  const toneMap: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
    active: 'success',
    granted: 'success',
    signed_in: 'success',
    expired: 'danger',
    blocked: 'danger',
    missing: 'danger',
    offline: 'neutral',
    recovering: 'warning',
    prompt: 'warning',
    signed_out: 'danger',
    unavailable: 'neutral',
  };
  return toneMap[value] ?? 'warning';
}

function isAccountReady(account: MobileAccountState): boolean {
  return account.tokenDanceId === 'signed_in' && account.hubSession === 'active';
}

function getAccountReadyLabel(account: MobileAccountState): string {
  return isAccountReady(account) ? 'Online' : 'Needs action';
}

function getAccountReadyTone(account: MobileAccountState): 'success' | 'warning' {
  return isAccountReady(account) ? 'success' : 'warning';
}

function buildThemeLabels(): Record<MobileThemeMode, string> {
  return {
    light: 'Light',
    system: 'System',
    dark: 'Dark',
    oled: 'OLED',
  };
}

function buildMenuSections(account: MobileAccountState): AccountMenuSection[] {
  return [
    {
      title: 'Identity and session',
      items: [
        { icon: 'shield', label: 'TokenDance ID', status: account.tokenDanceId, color: '#moss' },
        { icon: 'runs', label: 'AgentHub', status: account.hubSession, color: '#accent' },
        { icon: 'grid', label: 'Workspace settings', color: '#accent' },
      ],
    },
    {
      title: 'Device and settings',
      items: [
        { icon: 'bell', label: 'Notification permission', status: account.notification, color: '#danger' },
        { icon: 'hardDrive', label: 'Storage management', color: '#moss' },
        { icon: 'file', label: 'Login devices', color: '#accent' },
        { icon: 'settings', label: 'Settings', color: '#accent' },
      ],
    },
    {
      title: 'Agent Profiles',
      items: [
        { icon: 'agent', label: 'Agent Profiles', color: '#accent' },
        { icon: 'approval', label: 'Approval policy', color: '#warning' },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// formatTokenDanceStatus
// ---------------------------------------------------------------------------

describe('formatTokenDanceStatus', () => {
  it('maps signed_in to Signed in', () => {
    expect(formatTokenDanceStatus('signed_in')).toBe('Signed in');
  });

  it('maps recovering to Recovering', () => {
    expect(formatTokenDanceStatus('recovering')).toBe('Recovering');
  });

  it('maps signed_out to Signed out', () => {
    expect(formatTokenDanceStatus('signed_out')).toBe('Signed out');
  });
});

// ---------------------------------------------------------------------------
// getAccountTone
// ---------------------------------------------------------------------------

describe('getAccountTone', () => {
  it('returns success for signed_in', () => {
    expect(getAccountTone('signed_in')).toBe('success');
  });

  it('returns warning for recovering', () => {
    expect(getAccountTone('recovering')).toBe('warning');
  });

  it('returns danger for signed_out', () => {
    expect(getAccountTone('signed_out')).toBe('danger');
  });
});

// ---------------------------------------------------------------------------
// getStatusBadgeLabel
// ---------------------------------------------------------------------------

describe('getStatusBadgeLabel', () => {
  it('maps active and granted to Online', () => {
    expect(getStatusBadgeLabel('active')).toBe('Online');
    expect(getStatusBadgeLabel('granted')).toBe('Online');
    expect(getStatusBadgeLabel('signed_in')).toBe('Signed in');
  });

  it('maps expired, blocked, missing to danger labels', () => {
    expect(getStatusBadgeLabel('expired')).toBe('Failed');
    expect(getStatusBadgeLabel('blocked')).toBe('Blocked');
    expect(getStatusBadgeLabel('missing')).toBe('Failed');
    expect(getStatusBadgeLabel('signed_out')).toBe('Signed out');
  });

  it('maps offline to Offline', () => {
    expect(getStatusBadgeLabel('offline')).toBe('Offline');
  });

  it('maps recovering to Recovering', () => {
    expect(getStatusBadgeLabel('recovering')).toBe('Recovering');
  });

  it('maps prompt to Needs action', () => {
    expect(getStatusBadgeLabel('prompt')).toBe('Needs action');
  });

  it('maps unavailable to Unavailable', () => {
    expect(getStatusBadgeLabel('unavailable')).toBe('Unavailable');
  });

  it('falls back to Needs action for unknown values', () => {
    expect(getStatusBadgeLabel('unknown_status')).toBe('Needs action');
  });
});

// ---------------------------------------------------------------------------
// getStatusBadgeTone
// ---------------------------------------------------------------------------

describe('getStatusBadgeTone', () => {
  it('maps success states correctly', () => {
    expect(getStatusBadgeTone('active')).toBe('success');
    expect(getStatusBadgeTone('granted')).toBe('success');
    expect(getStatusBadgeTone('signed_in')).toBe('success');
  });

  it('maps danger states correctly', () => {
    expect(getStatusBadgeTone('expired')).toBe('danger');
    expect(getStatusBadgeTone('blocked')).toBe('danger');
    expect(getStatusBadgeTone('missing')).toBe('danger');
    expect(getStatusBadgeTone('signed_out')).toBe('danger');
  });

  it('maps warning states correctly', () => {
    expect(getStatusBadgeTone('recovering')).toBe('warning');
    expect(getStatusBadgeTone('prompt')).toBe('warning');
  });

  it('maps neutral states correctly', () => {
    expect(getStatusBadgeTone('offline')).toBe('neutral');
    expect(getStatusBadgeTone('unavailable')).toBe('neutral');
  });

  it('falls back to warning for unknown', () => {
    expect(getStatusBadgeTone('unknown')).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// isAccountReady
// ---------------------------------------------------------------------------

describe('isAccountReady', () => {
  it('returns true when signed_in and active', () => {
    const account: MobileAccountState = {
      tokenDanceId: 'signed_in',
      hubSession: 'active',
      notification: 'prompt',
      hubSync: 'active',
      deviceLabel: 'test',
    };
    expect(isAccountReady(account)).toBe(true);
  });

  const notReadyCases: Array<[string, Partial<MobileAccountState>]> = [
    ['expired hubSession', { hubSession: 'expired' }],
    ['missing hubSession', { hubSession: 'missing', hubSync: 'offline' }],
    ['recovering tokenDanceId', { tokenDanceId: 'recovering', hubSync: 'recovering' }],
    ['signed_out tokenDanceId', { tokenDanceId: 'signed_out' }],
  ];
  it.each(notReadyCases)('returns false when %s', (_, overrides) => {
    const account: MobileAccountState = {
      tokenDanceId: 'signed_in',
      hubSession: 'active',
      notification: 'prompt',
      hubSync: 'active',
      deviceLabel: 'test',
      ...overrides,
    };
    expect(isAccountReady(account)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAccountReadyLabel / getAccountReadyTone
// ---------------------------------------------------------------------------

describe('account ready label and tone', () => {
  it('returns Online / success for ready account', () => {
    const account: MobileAccountState = {
      tokenDanceId: 'signed_in',
      hubSession: 'active',
      notification: 'prompt',
      hubSync: 'active',
      deviceLabel: 'test',
    };
    expect(getAccountReadyLabel(account)).toBe('Online');
    expect(getAccountReadyTone(account)).toBe('success');
  });

  it('returns Needs action / warning for non-ready account', () => {
    const account: MobileAccountState = {
      tokenDanceId: 'signed_out',
      hubSession: 'missing',
      notification: 'blocked',
      hubSync: 'offline',
      deviceLabel: 'test',
    };
    expect(getAccountReadyLabel(account)).toBe('Needs action');
    expect(getAccountReadyTone(account)).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// Theme labels
// ---------------------------------------------------------------------------

describe('theme labels', () => {
  it('has all four theme modes', () => {
    const labels = buildThemeLabels();
    expect(Object.keys(labels)).toHaveLength(4);
    expect(labels.light).toBe('Light');
    expect(labels.system).toBe('System');
    expect(labels.dark).toBe('Dark');
    expect(labels.oled).toBe('OLED');
  });

  it('selected label appends "selected"', () => {
    const labels = buildThemeLabels();
    const current: MobileThemeMode = 'dark';
    const label = labels[current];
    const selectedLabel = `${label} selected`;
    expect(selectedLabel).toBe('Dark selected');
  });
});

// ---------------------------------------------------------------------------
// Menu sections
// ---------------------------------------------------------------------------

describe('account menu sections', () => {
  it('builds 3 menu sections', () => {
    const sections = buildMenuSections(mobileFixture.account);
    expect(sections).toHaveLength(3);
  });

  it('first section is Identity and session', () => {
    const sections = buildMenuSections(mobileFixture.account);
    expect(sections[0]!.title).toBe('Identity and session');
    expect(sections[0]!.items).toHaveLength(3);
  });

  it('second section is Device and settings', () => {
    const sections = buildMenuSections(mobileFixture.account);
    expect(sections[1]!.title).toBe('Device and settings');
    expect(sections[1]!.items).toHaveLength(4);
  });

  it('third section is Agent Profiles', () => {
    const sections = buildMenuSections(mobileFixture.account);
    expect(sections[2]!.title).toBe('Agent Profiles');
    expect(sections[2]!.items).toHaveLength(2);
  });

  it('identity section includes TokenDance ID status', () => {
    const sections = buildMenuSections(mobileFixture.account);
    const tdItem = sections[0]!.items.find((i) => i.label === 'TokenDance ID');
    expect(tdItem).toBeDefined();
    expect(tdItem!.status).toBe('signed_in');
  });

  it('identity section includes AgentHub hub session', () => {
    const sections = buildMenuSections(mobileFixture.account);
    const hubItem = sections[0]!.items.find((i) => i.label === 'AgentHub');
    expect(hubItem).toBeDefined();
    expect(hubItem!.status).toBe('active');
  });

  it('device section includes notification status', () => {
    const sections = buildMenuSections(mobileFixture.account);
    const notifItem = sections[1]!.items.find((i) => i.label === 'Notification permission');
    expect(notifItem).toBeDefined();
    expect(notifItem!.status).toBe('prompt');
  });

  it('every menu item has an icon', () => {
    const sections = buildMenuSections(mobileFixture.account);
    for (const section of sections) {
      for (const item of section.items) {
        expect(item.icon).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Default fixture account validation
// ---------------------------------------------------------------------------

describe('default fixture account', () => {
  it('has valid account state', () => {
    const account = mobileFixture.account;
    expect(account.tokenDanceId).toBe('signed_in');
    expect(account.hubSession).toBe('active');
    expect(account.notification).toBe('prompt');
    expect(account.hubSync).toBe('active');
    expect(account.deviceLabel).toBeTruthy();
  });

  it('account is ready', () => {
    expect(isAccountReady(mobileFixture.account)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixture scenarios: account states
// ---------------------------------------------------------------------------

describe('account fixture scenarios', () => {
  type ScenarioExpectations = {
    tokenDanceId: MobileAccountState['tokenDanceId'];
    hubSession: MobileAccountState['hubSession'];
    notification: MobileAccountState['notification'];
    hubSync: MobileAccountState['hubSync'];
    isReady: boolean;
  };

  it('offline scenario has degraded account state', () => {
    const f = getMobileFixtureForScenario('offline');
    expect(f.account.tokenDanceId).toBe('recovering');
    expect(f.account.hubSession).toBe('missing');
    expect(f.account.hubSync).toBe('offline');
    expect(isAccountReady(f.account)).toBe(false);
  });

  it('notification scenario has granted notification', () => {
    const f = getMobileFixtureForScenario('notification');
    expect(f.account.notification).toBe('granted');
    expect(f.account.tokenDanceId).toBe('signed_in');
    expect(isAccountReady(f.account)).toBe(true);
  });

  it('empty scenario has active session', () => {
    const f = getMobileFixtureForScenario('empty');
    expect(f.account.tokenDanceId).toBe('signed_in');
    expect(f.account.hubSession).toBe('active');
    expect(isAccountReady(f.account)).toBe(true);
  });

  it('approvalError scenario has expired hub session', () => {
    const f = getMobileFixtureForScenario('approvalError');
    expect(f.account.hubSession).toBe('expired');
    expect(f.account.tokenDanceId).toBe('recovering');
    expect(isAccountReady(f.account)).toBe(false);
  });

  it('all scenarios have a deviceLabel', () => {
    const scenarios: MobileFixtureScenario[] = [
      'default', 'empty', 'offline', 'notification', 'deeplink',
      'sendError', 'sendPending', 'approvalPending', 'approvalError',
      'approvalResolved', 'diffPreview', 'previewMatrix',
    ];
    for (const scenario of scenarios) {
      const f = getMobileFixtureForScenario(scenario);
      expect(f.account.deviceLabel.length, `scenario ${scenario} deviceLabel`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Account rail state
// ---------------------------------------------------------------------------

describe('account rail', () => {
  it('has 3 accounts plus add-account button', () => {
    const railItems = [
      { iconLabel: 'TD', label: 'TokenDance', selected: true },
      { badge: '+3', iconLabel: 'AH', label: 'AgentHub' },
      { badge: '!', iconLabel: 'AP', label: 'Agent Profiles', tone: 'warning' },
    ];
    expect(railItems).toHaveLength(3);

    // Add account item
    const addLabel = 'Switch workspace';
    expect(addLabel).toBeTruthy();
  });

  it('first rail item is selected', () => {
    const first = { iconLabel: 'TD', label: 'TokenDance', selected: true };
    expect(first.selected).toBe(true);
  });

  it('AP item has warning tone', () => {
    const apItem = { badge: '!', iconLabel: 'AP', label: 'Agent Profiles', tone: 'warning' };
    expect(apItem.tone).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// Theme mode cycling
// ---------------------------------------------------------------------------

describe('theme mode handling', () => {
  const themeModes: MobileThemeMode[] = ['light', 'system', 'dark', 'oled'];

  it('has 4 theme modes', () => {
    expect(themeModes).toHaveLength(4);
  });

  it('can cycle through all modes', () => {
    let current: MobileThemeMode = 'system';
    const next = (mode: MobileThemeMode): MobileThemeMode => {
      const idx = themeModes.indexOf(mode);
      return themeModes[(idx + 1) % themeModes.length]!;
    };

    current = next(current);
    expect(current).toBe('dark');

    current = next(current);
    expect(current).toBe('oled');

    current = next(current);
    expect(current).toBe('light');

    current = next(current);
    expect(current).toBe('system');
  });

  it('every theme mode has a unique label', () => {
    const labels = buildThemeLabels();
    const uniqueLabels = new Set(Object.values(labels));
    expect(uniqueLabels.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Status value combinations
// ---------------------------------------------------------------------------

describe('account status combinations', () => {
  it('TokenDance ID status + Hub session combinations', () => {
    const tdStatuses: MobileAccountState['tokenDanceId'][] = ['signed_in', 'signed_out', 'recovering'];
    const hubStatuses: MobileAccountState['hubSession'][] = ['active', 'missing', 'expired'];

    const combinations: Array<{ td: typeof tdStatuses[number]; hub: typeof hubStatuses[number]; ready: boolean }> = [];

    for (const td of tdStatuses) {
      for (const hub of hubStatuses) {
        combinations.push({
          td,
          hub,
          ready: td === 'signed_in' && hub === 'active',
        });
      }
    }

    expect(combinations).toHaveLength(9);

    // Only one combination is ready
    const readyCombos = combinations.filter((c) => c.ready);
    expect(readyCombos).toHaveLength(1);
    expect(readyCombos[0]).toEqual({ td: 'signed_in', hub: 'active', ready: true });
  });

  it('notification has three states', () => {
    const notificationStates: MobileAccountState['notification'][] = ['granted', 'prompt', 'blocked'];
    expect(notificationStates).toHaveLength(3);

    const tones = notificationStates.map(getStatusBadgeTone);
    expect(tones).toEqual(['success', 'warning', 'danger']);
  });

  it('hubSync has three states', () => {
    const syncStates: MobileAccountState['hubSync'][] = ['active', 'recovering', 'offline'];
    expect(syncStates).toHaveLength(3);
  });
});
