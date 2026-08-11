/**
 * Chatview fixtures: Pinned announcement transcript.
 * Peel companion of chatviewFixtures (#1132). Pure only; zero behavior change.
 */

import type { TranscriptBlock } from '../transcript/types'

// ═══════════════════════════════════════════════════════════════════════
// Pinned Announcement Conversation — simulates system-wide announcements
// from the Hub administrator. Mix of pinned text, attachments, and links.
// ═══════════════════════════════════════════════════════════════════════

const S = (id: string) => ({ id, name: 'System', role: 'system' as const })

export const chatviewAnnouncementTranscript: TranscriptBlock[] = [
  /* ── Pinned announcement: maintenance window ── */
  {
    id: 'an1', kind: 'text', createdAt: '2026-06-15T08:00:00+08:00',
    author: S('admin-hub'),
    text: 'SCHEDULED MAINTENANCE: The AgentHub API gateway will undergo a zero-downtime rolling restart on 2026-06-18 02:00-04:00 UTC. All active runs will be preserved. WebSocket connections will reconnect automatically. No action required from users.',
    displayTitle: 'Scheduled Maintenance',
    displayDetail: '2026-06-18 02:00-04:00 UTC · Zero-downtime rolling restart',
    badgeLabel: 'Pinned',
    badgeVariant: 'warning',
  },

  /* ── Attachment: Changelog PDF ── */
  {
    id: 'anatt1', kind: 'attachment', createdAt: '2026-06-15T08:05:00+08:00',
    author: S('admin-hub'),
    attachmentRef: {
      id: 'att_changelog_v2_4',
      name: 'changelog-v2.4.0.pdf',
      original_name: 'AgentHub Changelog v2.4.0.pdf',
      size: 456789,
      mime_type: 'application/pdf',
      hash: 'sha256:abcd1234ef567890abcd1234ef567890',
      url: '/client/attachments/att_changelog_v2_4',
      metadata: '{"pages": 12}',
      created_at: '2026-06-15T08:00:00+08:00',
    },
    contentType: 'file',
  },

  /* ── Pinned announcement: New model available ── */
  {
    id: 'an2', kind: 'text', createdAt: '2026-06-15T08:10:00+08:00',
    author: S('admin-hub'),
    text: 'NEW MODEL: Claude Sonnet 4.5 is now available for all agent runs. This model shows a 2.3x improvement on coding benchmarks and supports extended thinking (32K token budget). Update your agent configs to use `model: "claude-sonnet-4-5-20250929"` to opt in. Legacy Sonnet 4 remains the default until 2026-07-01.',
    displayTitle: 'New Model Available',
    displayDetail: 'Claude Sonnet 4.5 · 2.3x coding improvement · Extended thinking 32K',
    badgeLabel: 'Pinned',
    badgeVariant: 'primary',
  },

  /* ── Pinned announcement: Security advisory ── */
  {
    id: 'an3', kind: 'text', createdAt: '2026-06-16T10:00:00+08:00',
    author: S('admin-hub'),
    text: 'SECURITY ADVISORY: A privilege escalation vulnerability (CVE-2026-49975) was patched in nginx 1.30.2. All AgentHub gateway nodes (node-a, node-b, node-c, node-d) have been updated as of 2026-06-12. No exploitation detected. Full audit trail available in Fleet Hardening report. If you run self-hosted edge nodes, please update immediately.',
    displayTitle: 'Security Advisory',
    displayDetail: 'CVE-2026-49975 patched · All gateway nodes updated 2026-06-12',
    badgeLabel: 'Pinned',
    badgeVariant: 'danger',
  },

  /* ── Attachment: Fleet hardening report ── */
  {
    id: 'anatt2', kind: 'attachment', createdAt: '2026-06-16T10:05:00+08:00',
    author: S('admin-hub'),
    attachmentRef: {
      id: 'att_fleet_hardening',
      name: 'fleet-hardening-20260611.md',
      original_name: 'fleet-hardening-20260611.md',
      size: 18934,
      mime_type: 'text/markdown',
      hash: 'sha256:fleet1234hardening5678report9012',
      url: '/client/attachments/att_fleet_hardening',
      metadata: '{}',
      created_at: '2026-06-12T00:00:00+08:00',
    },
    contentType: 'file',
  },

  /* ── Pinned announcement: deprecation notice ── */
  {
    id: 'an4', kind: 'text', createdAt: '2026-06-17T09:00:00+08:00',
    author: S('admin-hub'),
    text: 'DEPRECATION NOTICE: The legacy `api/endpoints/` named-function exports will be removed in v2.5.0 (target: 2026-07-15). All consumers must migrate to the generic `createApiClient<Schema>()` pattern introduced in v2.4.0. See the migration guide for step-by-step instructions. 31 call sites have been identified; a tracking issue (#1224) with per-file checkboxes is available.',
    displayTitle: 'Deprecation Notice',
    displayDetail: 'Legacy endpoint exports removed in v2.5.0 · Target: 2026-07-15 · 31 call sites to migrate',
    badgeLabel: 'Pinned',
    badgeVariant: 'warning',
  },
]
