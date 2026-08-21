import React from 'react';
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
  const profile = resolveWorkbenchProfile(agent.id || agent.name, [agent]);

  return (
    <span
      aria-expanded={false}
      aria-haspopup="dialog"
      aria-label={`查看 ${profile.name} 资料`}
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

/** Known skill → capability tag mappings. */
const SKILL_CAPABILITY_MAP: Record<string, string> = {
  'code-review': 'Code Review',
  'frontend': '前端开发',
  'backend': '后端开发',
  'api-design': 'API Design',
  'testing': '测试',
  'security': '安全审计',
  'docs': '文档',
  'deploy': '部署',
  'research': '研究',
  'browser-qa': 'Browser QA',
  'Agent Market': 'Market',
  'Install Fixture': 'Fixture',
};

/**
 * Derives colored capability tags from an AgentConfig.
 * Uses skills first, then falls back to role keywords.
 */
export function deriveCapabilityTags(agent: AgentConfig): CapabilityTag[] {
  const tags: CapabilityTag[] = [];
  const seen = new Set<string>();

  // Derive from skills
  for (const skill of agent.skills) {
    const mapped = SKILL_CAPABILITY_MAP[skill];
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      tags.push({ label: mapped, color: tagColor(tags.length) });
    }
  }

  // If no skill-based tags, derive from role keywords
  if (tags.length === 0) {
    const role = agent.role.toLowerCase();
    const roleTags: Array<{ keywords: string[]; label: string }> = [
      { keywords: ['代码实现', 'implement', 'build', 'write'], label: '代码实现' },
      { keywords: ['审查', 'review'], label: 'Code Review' },
      { keywords: ['deploy', '发布', 'preview'], label: '部署' },
      { keywords: ['research', '研究'], label: '研究' },
      { keywords: ['test', '测试'], label: '测试' },
      { keywords: ['doc', '文档'], label: '文档' },
      { keywords: ['security', '安全'], label: '安全审计' },
      { keywords: ['api'], label: 'API Design' },
      { keywords: ['frontend', '前端'], label: '前端开发' },
      { keywords: ['backend', '后端'], label: '后端开发' },
    ];
    for (const { keywords, label } of roleTags) {
      if (keywords.some((kw) => role.includes(kw)) && !seen.has(label)) {
        seen.add(label);
        tags.push({ label, color: tagColor(tags.length) });
      }
    }
  }

  // Cap at 3 tags to avoid visual clutter
  return tags.slice(0, 3);
}
