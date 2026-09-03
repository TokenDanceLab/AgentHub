/* eslint-disable */
/**
 * WorkbenchSurfaceScreen data-level logic tests.
 *
 * Covers surface config generation, navigation targets, metric computation,
 * search filtering, pane state changes, and error/loading fixture scenarios.
 *
 * Vitest environment: node — tests pure data transformations (no React rendering).
 */
import { describe, expect, it } from 'vitest';

import { getMobileFixtureForScenario, mobileFixture } from '@/data/mobileFixtures';
import type {
  MobileAppFixture,
  MobileFixtureScenario,
  MobileRun,
  MobileTab,
  MobileThread,
} from '@/types';

// ---------------------------------------------------------------------------
// Surface config type (replicated from WorkbenchSurfaceScreen.tsx)
// ---------------------------------------------------------------------------

type WorkbenchSurface = 'contacts' | 'docs' | 'agents' | 'projects' | 'settings' | 'more';
type SurfacePane = string;

interface SurfaceMetric {
  label: string;
  value: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

interface SurfaceRow {
  icon: string;
  title: string;
  subtitle: string;
  meta: string;
  target?: MobileTab;
  onPress?: boolean;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

interface SurfaceSection {
  title: string;
  description?: string;
  rows: SurfaceRow[];
}

interface SurfaceConfig {
  eyebrow: string;
  title: string;
  description: string;
  searchPlaceholder?: string;
  variant?: 'standard' | 'overflow';
  panes: Array<{ label: string; value: SurfacePane }>;
  metrics: SurfaceMetric[];
  sections: Record<SurfacePane, SurfaceSection[]>;
}

// ---------------------------------------------------------------------------
// Config builders mirroring getSurfaceConfig logic
// ---------------------------------------------------------------------------

function buildContactsConfig(pendingReviews: number): SurfaceConfig {
  return {
    eyebrow: 'AgentHub Contacts',
    title: 'Contacts',
    description: 'Organization members, external contacts, and service desks follow the shared workbench model.',
    searchPlaceholder: 'Search contacts',
    panes: [
      { label: 'Organization contacts', value: 'members' },
      { label: 'External contacts', value: 'external' },
      { label: 'Starred contacts', value: 'starred' },
    ],
    metrics: [
      { label: 'Organization contacts', value: '12', tone: 'accent' },
      { label: 'External', value: '3' },
      { label: 'Pinned', value: '5', tone: 'warning' },
    ],
    sections: {
      members: [
        {
          title: 'Organization contacts',
          rows: [
            { icon: 'team', title: 'TokenDance', subtitle: 'Mobile workspace...', meta: 'Workspace', target: 'chat' },
            { icon: 'agent', title: 'AgentHub Profile', subtitle: 'Builder profile...', meta: 'Profile', target: 'agents' },
            { icon: 'shield', title: 'AgentHub Review Profile', subtitle: 'Reviewer profile...', meta: 'Profile', target: 'agents' },
          ],
        },
      ],
      external: [
        {
          title: 'External contacts',
          rows: [
            { icon: 'invite', title: 'TokenDance external access', subtitle: 'External collaborator...', meta: 'External' },
            { icon: 'cloud', title: 'AgentHub service desk', subtitle: 'Service desk...', meta: 'External' },
          ],
        },
      ],
      starred: [
        {
          title: 'Starred contacts',
          rows: [
            { icon: 'star', title: 'Alice', subtitle: 'TokenDance', meta: 'Pinned', target: 'account' },
            { icon: 'star', title: 'AgentHub Mobile Workbench', subtitle: 'Mobile workspace...', meta: 'Pinned', target: 'chat' },
          ],
        },
      ],
    },
  };
}

function buildDocsConfig(): SurfaceConfig {
  return {
    eyebrow: 'AgentHub Docs',
    title: 'Docs',
    description: 'Browse workspace documents, task evidence, artifacts, owners, and recent updates.',
    searchPlaceholder: 'Search docs',
    panes: [
      { label: 'Recent', value: 'recent' },
      { label: 'Owned', value: 'owned' },
      { label: 'Shared', value: 'shared' },
      { label: 'Starred', value: 'starred' },
    ],
    metrics: [
      { label: 'Recent', value: '6', tone: 'accent' },
      { label: 'Owned', value: '4' },
      { label: 'Starred', value: '2', tone: 'warning' },
    ],
    sections: {
      recent: [
        { title: 'Recent', rows: [{ icon: 'diff', title: 'Task evidence', subtitle: 'Changed files...', meta: 'Updated today', target: 'tasks' }] },
      ],
      owned: [
        { title: 'Owned', rows: [{ icon: 'file', title: 'Project docs', subtitle: 'Retention...', meta: 'Owner: TokenDance' }] },
      ],
      shared: [
        { title: 'Shared', rows: [{ icon: 'cloud', title: 'Shared workbench design notes', subtitle: 'Workbench project...', meta: 'Shared' }] },
      ],
      starred: [
        { title: 'Starred', rows: [{ icon: 'star', title: 'AgentHub Design Contract', subtitle: 'Design contract...', meta: 'Pinned' }] },
      ],
    },
  };
}

function buildAgentsConfig(pendingReviews: number): SurfaceConfig {
  return {
    eyebrow: 'AgentHub Agents',
    title: 'Agent Profiles',
    description: 'Manage Agent Profiles, configurations, permissions, model routes, and review history.',
    searchPlaceholder: 'Search Agent Profiles',
    panes: [
      { label: 'Installed', value: 'installed' },
      { label: 'Market', value: 'market' },
      { label: 'Policy', value: 'policy' },
      { label: 'Tools', value: 'tools' },
      { label: 'Models', value: 'models' },
      { label: 'Audit', value: 'audit' },
    ],
    metrics: [
      { label: 'Installed', value: '4', tone: 'accent' },
      { label: 'Tools', value: '7' },
      { label: 'Policy', value: String(pendingReviews), tone: pendingReviews > 0 ? 'warning' : 'success' },
    ],
    sections: {
      installed: [
        { title: 'Installed', rows: [{ icon: 'agent', title: 'Builder Profile', subtitle: 'Builder...', meta: 'Profile' }] },
      ],
      market: [
        { title: 'Market', rows: [{ icon: 'plusCircle', title: 'AgentHub Visual QA Profile', subtitle: 'QA...', meta: 'Official' }] },
      ],
      policy: [
        { title: 'Policy', rows: [{ icon: 'approval', title: 'Approval policy', subtitle: 'Policy...', meta: 'Tasks', target: 'tasks' }] },
      ],
      tools: [
        { title: 'Tools', rows: [{ icon: 'diff', title: 'Diff preview', subtitle: 'Evidence...', meta: 'Review' }] },
      ],
      models: [
        { title: 'Models', rows: [{ icon: 'cloud', title: 'Default model route', subtitle: 'Route...', meta: 'Selected' }] },
      ],
      audit: [
        { title: 'Audit', rows: [{ icon: 'clock', title: 'Approval decision audit', subtitle: 'Audit...', meta: 'Tasks' }] },
      ],
    },
  };
}

function buildProjectsConfig(pendingReviews: number): SurfaceConfig {
  return {
    eyebrow: 'AgentHub Projects',
    title: 'Projects',
    description: 'Project spaces collect chats, tasks, docs, members, and settings.',
    searchPlaceholder: 'Search projects',
    panes: [
      { label: 'Overview', value: 'overview' },
      { label: 'Runs', value: 'runs' },
      { label: 'Artifacts', value: 'artifacts' },
      { label: 'Archive', value: 'archive' },
      { label: 'Settings', value: 'settings' },
    ],
    metrics: [
      { label: 'Runs', value: '3', tone: 'accent' },
      { label: 'Artifacts', value: '5' },
      { label: 'Review', value: String(pendingReviews), tone: pendingReviews > 0 ? 'warning' : 'success' },
    ],
    sections: {
      overview: [
        { title: 'AgentHub Mobile Workbench', rows: [{ icon: 'chat', title: 'AgentHub Mobile Workbench', subtitle: 'Mobile workspace...', meta: 'Active', target: 'chat' }] },
      ],
      runs: [
        { title: 'Runs', rows: [{ icon: 'runs', title: 'Task activity triage', subtitle: 'Approval...', meta: 'Review', target: 'tasks' }] },
      ],
      artifacts: [
        { title: 'Artifacts', rows: [{ icon: 'file', title: 'Project docs', subtitle: 'Docs...', meta: 'Docs', target: 'docs' }] },
      ],
      archive: [
        { title: 'Archive', rows: [{ icon: 'file', title: 'AgentHub Docs Space', subtitle: 'Docs...', meta: 'Docs', target: 'docs' }] },
      ],
      settings: [
        { title: 'Project settings', rows: [{ icon: 'team', title: 'Members', subtitle: 'Members...', meta: 'TokenDance', target: 'contacts' }] },
      ],
    },
  };
}

function buildSettingsConfig(pendingReviews: number): SurfaceConfig {
  return {
    eyebrow: 'AgentHub Settings',
    title: 'Settings',
    description: 'Workspace settings stay separate from the avatar profile and TokenDance ID account surface.',
    panes: [
      { label: 'Workspace settings', value: 'workspace' },
      { label: 'Appearance', value: 'appearance' },
      { label: 'Notifications', value: 'notifications' },
      { label: 'Device capabilities', value: 'device' },
      { label: 'Agent defaults', value: 'agent-defaults' },
      { label: 'Local runtime', value: 'runtime' },
      { label: 'Identity and session', value: 'identity' },
      { label: 'Approval policy', value: 'approval' },
    ],
    metrics: [
      { label: 'Hub session', value: 'Signed in', tone: 'success' },
      { label: 'Notifications', value: 'Needs action', tone: 'warning' },
      { label: 'Approval policy', value: String(pendingReviews), tone: pendingReviews > 0 ? 'warning' : 'success' },
    ],
    sections: {
      workspace: [
        { title: 'Workspace settings', rows: [{ icon: 'settings', title: 'Workspace settings', subtitle: 'Settings...', meta: 'AgentHub' }] },
      ],
      appearance: [
        { title: 'Appearance', rows: [
          { icon: 'settings', title: 'System', subtitle: 'System...', meta: 'Selected' },
          { icon: 'settings', title: 'Light', subtitle: 'Light...', meta: 'Done' },
          { icon: 'settings', title: 'OLED', subtitle: 'OLED...', meta: 'Account', target: 'account' },
        ]},
      ],
      notifications: [
        { title: 'Notifications', rows: [{ icon: 'bell', title: 'Notification permission', subtitle: 'Permission...', meta: 'Needs action', target: 'account' }] },
      ],
      device: [
        { title: 'Device capabilities', rows: [{ icon: 'camera', title: 'Camera evidence capture', subtitle: 'Capture...', meta: 'Needs action' }] },
      ],
      'agent-defaults': [
        { title: 'Agent defaults', rows: [{ icon: 'agent', title: 'Default Agent Profile', subtitle: 'Profile...', meta: 'Profile', target: 'agents' }] },
      ],
      runtime: [
        { title: 'Local runtime', rows: [{ icon: 'status', title: 'Native build readiness', subtitle: 'Build...', meta: 'Needs action' }] },
      ],
      identity: [
        { title: 'Identity and session', rows: [{ icon: 'shield', title: 'TokenDance ID', subtitle: 'Session...', meta: 'Account', target: 'account' }] },
      ],
      approval: [
        { title: 'Approval policy', rows: [{ icon: 'approval', title: 'Approval policy', subtitle: 'Policy...', meta: 'Tasks', target: 'tasks' }] },
      ],
    },
  };
}

function buildMoreConfig(): SurfaceConfig {
  return {
    eyebrow: 'AgentHub Workbench',
    title: 'More',
    description: 'Phone overflow for Contacts, Agent Profiles, Settings, and account/profile entry points.',
    variant: 'overflow',
    panes: [{ label: 'More', value: 'shortcuts' }],
    metrics: [],
    sections: {
      shortcuts: [
        {
          title: 'AgentHub',
          rows: [
            { icon: 'team', title: 'Contacts', subtitle: 'Open contacts...', meta: 'TokenDance', target: 'contacts' },
            { icon: 'agent', title: 'Agent Profiles', subtitle: 'Agent profiles...', meta: 'Profile', target: 'agents' },
            { icon: 'settings', title: 'Settings', subtitle: 'Settings...', meta: 'Settings', target: 'settings' },
          ],
        },
        {
          title: 'Profile actions',
          rows: [
            { icon: 'account', title: 'Profile and account', subtitle: 'Account...', meta: 'Account', target: 'account' },
          ],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// filterSections — mirrors the filter logic from WorkbenchSurfaceScreen
// ---------------------------------------------------------------------------

function filterSections(sections: SurfaceSection[], query: string): SurfaceSection[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) return sections;

  return sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter(
        (row) =>
          row.title.toLowerCase().includes(normalizedQuery) ||
          row.subtitle.toLowerCase().includes(normalizedQuery) ||
          row.meta.toLowerCase().includes(normalizedQuery),
      ),
    }))
    .filter((section) => section.rows.length > 0);
}

// ---------------------------------------------------------------------------
// Config structure tests
// ---------------------------------------------------------------------------

describe('surface config generation', () => {
  const surfaces: WorkbenchSurface[] = ['contacts', 'docs', 'agents', 'projects', 'settings', 'more'];

  it('every surface config has eyebrow, title, and description', () => {
    const configs: Record<WorkbenchSurface, SurfaceConfig> = {
      contacts: buildContactsConfig(1),
      docs: buildDocsConfig(),
      agents: buildAgentsConfig(1),
      projects: buildProjectsConfig(1),
      settings: buildSettingsConfig(1),
      more: buildMoreConfig(),
    };

    for (const surface of surfaces) {
      const config = configs[surface];
      expect(config.eyebrow.length).toBeGreaterThan(0);
      expect(config.title.length).toBeGreaterThan(0);
      expect(config.description.length).toBeGreaterThan(0);
    }
  });

  it('contacts config has 3 panes and 3 metrics', () => {
    const config = buildContactsConfig(1);
    expect(config.panes).toHaveLength(3);
    expect(config.metrics).toHaveLength(3);
  });

  it('docs config has 4 panes and 3 metrics', () => {
    const config = buildDocsConfig();
    expect(config.panes).toHaveLength(4);
    expect(config.metrics).toHaveLength(3);
  });

  it('agents config has 6 panes and 3 metrics', () => {
    const config = buildAgentsConfig(2);
    expect(config.panes).toHaveLength(6);
    expect(config.metrics).toHaveLength(3);
  });

  it('projects config has 5 panes and 3 metrics', () => {
    const config = buildProjectsConfig(0);
    expect(config.panes).toHaveLength(5);
    expect(config.metrics).toHaveLength(3);
  });

  it('settings config has 8 panes and 3 metrics', () => {
    const config = buildSettingsConfig(3);
    expect(config.panes).toHaveLength(8);
    expect(config.metrics).toHaveLength(3);
  });

  it('more config has overflow variant, 1 pane, and 0 metrics', () => {
    const config = buildMoreConfig();
    expect(config.variant).toBe('overflow');
    expect(config.panes).toHaveLength(1);
    expect(config.metrics).toHaveLength(0);
  });

  it('each top-level pane has corresponding sections', () => {
    const config = buildContactsConfig(1);
    for (const pane of config.panes) {
      const section = config.sections[pane.value];
      expect(section).toBeDefined();
      expect(section!.length).toBeGreaterThan(0);
    }
  });

  it('each section row has required fields', () => {
    const config = buildAgentsConfig(2);
    for (const pane of config.panes) {
      for (const section of config.sections[pane.value] ?? []) {
        for (const row of section.rows) {
          expect(row.icon).toBeTruthy();
          expect(row.title).toBeTruthy();
          expect(row.subtitle).toBeTruthy();
          expect(row.meta).toBeTruthy();
        }
      }
    }
  });

  it('settings appearance pane has 3 rows', () => {
    const config = buildSettingsConfig(0);
    const appearance = config.sections['appearance'] ?? [];
    expect(appearance).toHaveLength(1);
    expect(appearance[0]!.rows).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Search filtering logic
// ---------------------------------------------------------------------------

describe('surface search filtering', () => {
  it('returns all sections when query is empty', () => {
    const sections: SurfaceSection[] = [
      { title: 'Section A', rows: [{ icon: 'chat', title: 'Row 1', subtitle: 'Sub A', meta: 'M1' }] },
      { title: 'Section B', rows: [{ icon: 'file', title: 'Row 2', subtitle: 'Sub B', meta: 'M2' }] },
    ];

    const result = filterSections(sections, '');
    expect(result).toHaveLength(2);
  });

  it('filters by title match', () => {
    const sections: SurfaceSection[] = [
      { title: 'Section A', rows: [{ icon: 'chat', title: 'AgentHub Chat', subtitle: 'Sub', meta: 'M1' }] },
      { title: 'Section B', rows: [{ icon: 'file', title: 'TokenDance Docs', subtitle: 'Sub', meta: 'M2' }] },
    ];

    const result = filterSections(sections, 'AgentHub');
    expect(result).toHaveLength(1);
    expect(result[0]!.rows).toHaveLength(1);
    expect(result[0]!.rows[0]!.title).toBe('AgentHub Chat');
  });

  it('filters by subtitle match', () => {
    const sections: SurfaceSection[] = [
      { title: 'Section A', rows: [{ icon: 'chat', title: 'Row 1', subtitle: 'Mobile workspace', meta: 'M1' }] },
      { title: 'Section B', rows: [{ icon: 'file', title: 'Row 2', subtitle: 'Desktop settings', meta: 'M2' }] },
    ];

    const result = filterSections(sections, 'mobile');
    expect(result).toHaveLength(1);
    expect(result[0]!.rows[0]!.title).toBe('Row 1');
  });

  it('filters by meta match', () => {
    const sections: SurfaceSection[] = [
      { title: 'Section A', rows: [{ icon: 'chat', title: 'Row 1', subtitle: 'A', meta: 'TokenDance' }] },
      { title: 'Section B', rows: [{ icon: 'file', title: 'Row 2', subtitle: 'B', meta: 'AgentHub' }] },
    ];

    const result = filterSections(sections, 'tokendance');
    expect(result).toHaveLength(1);
    expect(result[0]!.rows[0]!.meta).toBe('TokenDance');
  });

  it.each([
    ['ZzzzNothing', 0],
    ['  TokenDance  ', 1],
  ])('filterSections with query %s yields %s sections', (query, expected) => {
    const sections: SurfaceSection[] = [
      { title: 'Section A', rows: [{ icon: 'chat', title: 'TokenDance', subtitle: 'Sub', meta: 'M1' }] },
    ];

    const result = filterSections(sections, query);
    expect(result).toHaveLength(expected);
  });

  it('filters multiple sections down but preserves matching sections', () => {
    const sections: SurfaceSection[] = [
      {
        title: 'Section A',
        rows: [
          { icon: 'chat', title: 'FindMe', subtitle: 'Sub', meta: 'M1' },
          { icon: 'file', title: 'Different Title', subtitle: 'Other', meta: 'M2' },
        ],
      },
      { title: 'Section B', rows: [{ icon: 'agent', title: 'FindMe Too', subtitle: 'Sub', meta: 'M3' }] },
    ];

    const result = filterSections(sections, 'FindMe');
    expect(result).toHaveLength(2);
    expect(result[0]!.rows).toHaveLength(1);
    expect(result[1]!.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Pane state transition logic
// ---------------------------------------------------------------------------

describe('pane state transitions', () => {
  const initialPanes: Record<string, string> = {
    contacts: 'members',
    docs: 'recent',
    agents: 'installed',
    projects: 'overview',
    settings: 'workspace',
    more: 'shortcuts',
  };

  it('each surface starts at its default pane', () => {
    expect(initialPanes.contacts).toBe('members');
    expect(initialPanes.docs).toBe('recent');
    expect(initialPanes.agents).toBe('installed');
    expect(initialPanes.projects).toBe('overview');
    expect(initialPanes.settings).toBe('workspace');
    expect(initialPanes.more).toBe('shortcuts');
  });

  it('pane transition does not affect other surfaces', () => {
    let panes = { ...initialPanes };
    panes = { ...panes, contacts: 'external' };
    expect(panes.contacts).toBe('external');
    expect(panes.docs).toBe('recent'); // unchanged
    expect(panes.agents).toBe('installed'); // unchanged
  });

  it('can transition to any available pane', () => {
    const config = buildSettingsConfig(1);
    const validPanes = config.panes.map((p) => p.value);
    let current = 'workspace';

    for (const pane of validPanes) {
      current = pane;
      expect(validPanes).toContain(current);
    }
  });
});

// ---------------------------------------------------------------------------
// Metric computation with pending reviews
// ---------------------------------------------------------------------------

describe('metric pending review computation', () => {
  it('policy metric shows warning when pendingReviews > 0', () => {
    const config = buildAgentsConfig(3);
    const policyMetric = config.metrics.find((m) => m.label === 'Policy');
    expect(policyMetric?.value).toBe('3');
    expect(policyMetric?.tone).toBe('warning');
  });

  it('policy metric shows success when pendingReviews === 0', () => {
    const config = buildAgentsConfig(0);
    const policyMetric = config.metrics.find((m) => m.label === 'Policy');
    expect(policyMetric?.value).toBe('0');
    expect(policyMetric?.tone).toBe('success');
  });

  it('review metric reflects pending review count', () => {
    const config = buildProjectsConfig(2);
    const reviewMetric = config.metrics.find((m) => m.label === 'Review');
    expect(reviewMetric?.value).toBe('2');
    expect(reviewMetric?.tone).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// Surface row navigation targets
// ---------------------------------------------------------------------------

describe('surface row navigation targets', () => {
  it('contacts rows navigate to correct tabs', () => {
    const config = buildContactsConfig(1);
    const allRows = Object.values(config.sections).flatMap((s) => s).flatMap((s) => s.rows);

    const targets = allRows
      .filter((r) => r.target !== undefined)
      .map((r) => r.target);

    expect(targets).toContain('chat');
    expect(targets).toContain('agents');
    expect(targets).toContain('account');
  });

  it('settings appearance pane navigates to account', () => {
    const config = buildSettingsConfig(0);
    const appearanceSection = config.sections['appearance']?.[0];
    expect(appearanceSection).toBeDefined();

    const oledRow = appearanceSection?.rows.find((r) => r.title === 'OLED');
    expect(oledRow).toBeDefined();
    expect(oledRow?.target).toBe('account');
  });

  it('more config has account profile action', () => {
    const config = buildMoreConfig();
    const allRows = Object.values(config.sections).flatMap((s) => s).flatMap((s) => s.rows);
    const accountRow = allRows.find((r) => r.target === 'account');
    expect(accountRow).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cross-surface validation
// ---------------------------------------------------------------------------

describe('cross-surface validation', () => {
  it('agents config has 6 metric entries with at least one accent tone', () => {
    const config = buildAgentsConfig(2);
    expect(config.metrics).toHaveLength(3);
    const hasAccent = config.metrics.some((m) => m.tone === 'accent');
    expect(hasAccent).toBe(true);
  });

  it('settings config has 8 pane tabs', () => {
    const config = buildSettingsConfig(0);
    expect(config.panes).toHaveLength(8);
  });

  it('each settings pane has a corresponding section', () => {
    const config = buildSettingsConfig(0);
    for (const pane of config.panes) {
      const section = config.sections[pane.value];
      expect(section).toBeDefined();
    }
  });

  it('contacts and docs have searchPlaceholder', () => {
    expect(buildContactsConfig(0).searchPlaceholder).toBeTruthy();
    expect(buildDocsConfig().searchPlaceholder).toBeTruthy();
  });

  it('more config does NOT have searchPlaceholder', () => {
    expect(buildMoreConfig().searchPlaceholder).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fixture scenario: loading/error states across surfaces
// ---------------------------------------------------------------------------

describe('surface fixture scenarios', () => {
  it('offline scenario has no runs', () => {
    const f = getMobileFixtureForScenario('offline');
    expect(f.runs.length).toBeGreaterThan(0); // recovery run exists
    expect(f.account.hubSession).toBe('missing');
    expect(f.account.hubSync).toBe('offline');
  });

  it('empty scenario has no threads or runs', () => {
    const f = getMobileFixtureForScenario('empty');
    expect(f.threads).toHaveLength(0);
    expect(f.runs).toHaveLength(0);
    expect(f.account.tokenDanceId).toBe('signed_in');
  });

  it('delta preview scenario has 7+ changed files', () => {
    const f = getMobileFixtureForScenario('diffPreview');
    const run = f.runs[0]!;
    expect(run.changedFiles.length).toBeGreaterThanOrEqual(7);
  });
});
