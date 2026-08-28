import React from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { resolveWorkbenchProfile } from '../../profileRegistry';
import styles from '../AgentsPage.module.css';
import type { AgentConfig, AgentState } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Shared installed-view presentational parts.

   Extracted from AgentInstalledViews as Phase 22 residual thin #616.
   CSS remains on shared AgentsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export const AgentStat: React.FC<{ label: string; value: string | number; meta: string }> = ({
  label,
  value,
  meta,
}) => (
  <article className={styles['agent-stat']}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{meta}</small>
  </article>
);

export const AgentAvatar: React.FC<{
  agent: AgentConfig;
  onAgentProfileOpen?: ((agent: AgentConfig, anchor: HTMLElement) => void) | undefined;
}> = ({ agent, onAgentProfileOpen }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const profile = resolveWorkbenchProfile(agent.id || agent.name, [agent]);

  return (
    <span
      aria-expanded={false}
      aria-haspopup="dialog"
      aria-label={t('agents.installed.avatarAria', { name: profile.name })}
      className={styles['agent-avatar']}
      data-agent-profile={profile.name}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onAgentProfileOpen?.(agent, event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        onAgentProfileOpen?.(agent, event.currentTarget);
      }}
      role="button"
      style={{ background: agent.avatarColor || profile.color }}
      tabIndex={0}
      title={agent.avatarRef ? `${profile.name} ${agent.avatarRef}` : `${profile.name} ${profile.label}`}
    >
      {profile.initials}
    </span>
  );
};

export const CapabilityBadge: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span className={styles['capability-badge']} title={`${label}: ${value}`}>
    <em>{label}</em>
    <strong>{value}</strong>
  </span>
);

export function stateClass(state: AgentState): string {
  if (state === 'running') return styles.running ?? '';
  if (state === 'ready') return styles.ready ?? '';
  if (state === 'waiting') return styles.waiting ?? '';
  return '';
}

function tagColor(index: number): string {
  return CAPABILITY_TAG_COLORS[index % CAPABILITY_TAG_COLORS.length] ?? 'tag-blue';
}

/* ── Capability tag derivation ── */

interface CapabilityTag {
  label: string;
  color: string;
}

const CAPABILITY_TAG_COLORS = ['tag-blue', 'tag-green', 'tag-orange', 'tag-purple', 'tag-teal'];

/**
 * Known skill → capability tag mappings. Translatable labels carry a
 * sharedWorkbench resource key (resolved through `t` at derivation time);
 * ASCII labels stay verbatim literals. #2007
 */
const SKILL_CAPABILITY_LABEL_KEYS: Record<string, string> = {
  'frontend': 'agents.capability.frontend',
  'backend': 'agents.capability.backend',
  'testing': 'agents.capability.testing',
  'security': 'agents.capability.security',
  'docs': 'agents.capability.docs',
  'deploy': 'agents.capability.deploy',
  'research': 'agents.capability.research',
};

const SKILL_CAPABILITY_LITERAL_LABELS: Record<string, string> = {
  'code-review': 'Code Review',
  'api-design': 'API Design',
  'browser-qa': 'Browser QA',
  'Agent Market': 'Market',
  'Install Fixture': 'Fixture',
};

/**
 * Translator signature for pure helpers receiving the component's `t`.
 * Uses i18next's TFunction directly: a structural `(key, options?)` shape
 * is not assignable from TFunction under exactOptionalPropertyTypes
 * (desktop tsconfig), which broke frontend-desktop CI. #2012
 */
export type CapabilityTagTranslator = TFunction<'sharedWorkbench'>;

/**
 * Derives colored capability tags from an AgentConfig.
 * Uses skills first, then falls back to role keywords.
 * Role keyword lists are matching data (not UI copy) and stay verbatim;
 * display labels resolve through the sharedWorkbench bundle. #2007
 */
export function deriveCapabilityTags(
  agent: AgentConfig,
  t: CapabilityTagTranslator,
): CapabilityTag[] {
  const tags: CapabilityTag[] = [];
  const seen = new Set<string>();
  const pushTag = (label: string | undefined) => {
    if (!label || seen.has(label)) return;
    seen.add(label);
    tags.push({ label, color: tagColor(tags.length) });
  };

  // Derive from skills
  for (const skill of agent.skills) {
    const labelKey = SKILL_CAPABILITY_LABEL_KEYS[skill];
    pushTag(labelKey ? t(labelKey) : SKILL_CAPABILITY_LITERAL_LABELS[skill]);
  }

  // If no skill-based tags, derive from role keywords
  if (tags.length === 0) {
    const role = agent.role.toLowerCase();
    const roleTags: Array<{
      keywords: string[];
      labelKey?: string | undefined;
      labelText?: string | undefined;
    }> = [
      { keywords: ['代码实现', 'implement', 'build', 'write'], labelKey: 'agents.capability.codeImpl' },
      { keywords: ['审查', 'review'], labelText: 'Code Review' },
      { keywords: ['deploy', '发布', 'preview'], labelKey: 'agents.capability.deploy' },
      { keywords: ['research', '研究'], labelKey: 'agents.capability.research' },
      { keywords: ['test', '测试'], labelKey: 'agents.capability.testing' },
      { keywords: ['doc', '文档'], labelKey: 'agents.capability.docs' },
      { keywords: ['security', '安全'], labelKey: 'agents.capability.security' },
      { keywords: ['api'], labelText: 'API Design' },
      { keywords: ['frontend', '前端'], labelKey: 'agents.capability.frontend' },
      { keywords: ['backend', '后端'], labelKey: 'agents.capability.backend' },
    ];
    for (const { keywords, labelKey, labelText } of roleTags) {
      if (keywords.some((kw) => role.includes(kw))) {
        pushTag(labelKey ? t(labelKey) : labelText);
      }
    }
  }

  // Cap at 3 tags to avoid visual clutter
  return tags.slice(0, 3);
}
