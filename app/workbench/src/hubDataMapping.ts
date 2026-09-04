/**
 * Shared data mapping: Hub API types → Workbench UI types.
 *
 * Used by both Web (useWebWorkbenchModel) and Desktop (useDesktopWorkbenchModel)
 * to convert Hub REST responses into the presentational types consumed by
 * shared workbench pages.
 *
 * Extracted from app/web/src/platform/useWebWorkbenchModel.ts to avoid drift.
 */

import { appDateLocaleTag } from '@shared/i18n/locale';
import { getI18n } from 'react-i18next';
import type { ContactMember, ProjectInfo } from './pages';
import type { WorkbenchContactsData } from './WorkbenchRoutes';
import type { DocRow } from './pages/DocsPage';
import type { WorkbenchConversation } from '@shared/platform';
import {
  isWorkbenchFixtureDataMode,
  type WorkbenchDataMode,
} from '@shared/demo';

// ── Contact mapping ────────────────────────────────────────────────

/** Re-export the "empty contacts" constant so both surfaces share one object. */
export const hubEmptyContacts: WorkbenchContactsData = {
  members: [],
  externalContacts: [],
  pendingContacts: [],
  starredContacts: [],
  groups: [],
  recentShortcuts: [],
  orgName: 'TokenDance',
  orgInitials: 'TD',
};

/**
 * Minimal Hub contact shape needed for mapping.
 * Both Desktop and Web hubClients define a compatible `ContactInfo` / `Contact` type.
 */
export interface HubContactLike {
  user_id: string;
  username?: string;
  nickname?: string;
  remark?: string;
  avatar_url?: string;
  online?: boolean;
  type?: string;
}

export function contactInfoToMember(contact: HubContactLike): ContactMember {
  const displayName = contact.remark?.trim() || contact.nickname?.trim() || contact.username || contact.user_id;
  return {
    id: contact.user_id,
    name: displayName,
    initials: contactInitials(displayName),
    org: contact.type === 'external' ? '外部联系人' : 'TokenDance',
    status: contact.online ? '在线' : '离线',
    tag: contact.type === 'external' ? 'External' : 'Hub',
  };
}

export function resolveHubContacts(
  contacts: HubContactLike[] | undefined,
  hubReady: boolean,
  dataMode: WorkbenchDataMode,
  loadError?: string | undefined,
): WorkbenchContactsData | undefined {
  // #1821: a failed request must not collapse into an empty contact list.
  // Returning undefined lets the page show its error state; the shell passes
  // the request error through the optional `loadError` argument.
  if (loadError) return undefined;
  if (!hubReady) {
    return isWorkbenchFixtureDataMode(dataMode) ? undefined : hubEmptyContacts;
  }
  const members = contacts?.map(contactInfoToMember) ?? [];
  return {
    ...hubEmptyContacts,
    members,
    starredContacts: members.slice(0, 2),
    recentShortcuts: members.slice(0, 3).map((member) => member.name),
  };
}

function contactInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'U';
  const chars = Array.from(trimmed);
  const asciiWords = trimmed.match(/[A-Za-z0-9]+/g);
  if (asciiWords && asciiWords.length > 0) {
    return asciiWords
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || 'U';
  }
  return chars.slice(0, 2).join('').toUpperCase();
}

// ── Project mapping ────────────────────────────────────────────────

/**
 * Minimal Hub workspace project shape needed for mapping.
 */
export interface HubWorkspaceProjectLike {
  id: string;
  name?: string;
  description?: string;
  owner_id?: string;
  created_at?: string;
  updated_at?: string;
}

// #2274 B-6: 这里曾经有一个共享的 workspaceProjectToProjectInfo，它把每个 Hub
// 项目硬编码成 status:'Active'——一个 Hub 侧不存在的词（Hub 的 workspace/project
// DTO、openapi、migration、live DB 都没有 status 字段）。#2291 删掉它唯一的
// 调用者后它成为 0 消费者孤儿，却仍被 hubDataMapping.test.ts 的注释宣称
// 「Desktop 在用」而留了下来。真正的 per-shell mapper 在
// app/web/src/platform/webWorkbenchProjects.ts 与
// app/desktop/src/platform/useDesktopWorkbenchModel.ts；canonical 的 L2 映射
// 只有在 Hub 获得真 lifecycle 事实（ADR-034 的 operator 裁决）之后才应回到这里。

export function resolveHubProjects<TProject extends HubWorkspaceProjectLike>(
  projects: TProject[] | undefined,
  hubReady: boolean,
  dataMode: WorkbenchDataMode,
  mapFn: (project: TProject) => ProjectInfo,
  loadError?: string | undefined,
): ProjectInfo[] | undefined {
  // #1821: a failed request must not collapse into an empty list; undefined
  // lets the page show its error state.
  if (loadError) return undefined;
  if (!hubReady) {
    return isWorkbenchFixtureDataMode(dataMode) ? undefined : [];
  }
  return (projects ?? []).map(mapFn);
}

// ── Document mapping ────────────────────────────────────────────────

/**
 * Minimal Hub document shape needed for mapping.
 * Both Desktop and Web hubClients define a compatible `HubDocumentListItem` type.
 */
export interface HubDocumentLike {
  id: string;
  owner_id?: string;
  title: string;
  tag?: string;
  location: string;
  status?: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

export function hubDocumentToDocRow(doc: HubDocumentLike): DocRow {
  const tag = doc.tag?.trim();
  return {
    id: doc.id,
    title: doc.title?.trim() || '未命名文档',
    ...(tag ? { tag } : {}),
    location: doc.location?.trim() || '我的文档库',
    owner: doc.owner_id?.trim() || 'Hub',
    time: formatDocTime(doc.updated_at ?? doc.created_at),
  };
}

function formatDocTime(value: string | undefined): string {
  if (!value) return 'Hub';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
  if (diffDays === 1) {
    return `昨天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

export function resolveHubDocuments(
  documents: HubDocumentLike[] | undefined,
  hubReady: boolean,
  dataMode: WorkbenchDataMode,
  loadError?: string | undefined,
): DocRow[] | undefined {
  // #1821: a failed request must not collapse into an empty list; undefined
  // lets the page show its error state.
  if (loadError) return undefined;
  if (!hubReady) {
    return isWorkbenchFixtureDataMode(dataMode) ? undefined : [];
  }
  return (documents ?? []).filter((doc) => doc.status !== 'deleted').map(hubDocumentToDocRow);
}

// ── Session → Conversation mapping ────────────────────────────────

/**
 * Minimal Hub session shape needed for conversation mapping.
 * Both Desktop and Web hubClients define a compatible `Session` type.
 */
export interface HubSessionLike {
  id?: string;
  session_id?: string;
  type: string;
  name?: string;
  title?: string;
  owner_user_id?: string;
  members?: Array<{ member_id: string; role?: string }>;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  unread_count?: number;
  last_message_at?: string;
  member_count?: number;
  created_at?: string;
  updated_at?: string;
}

export function hubSessionToConversation(session: HubSessionLike): WorkbenchConversation {
  const sessionId = session.id || session.session_id || '';
  const kind: WorkbenchConversation['kind'] = session.type === 'private' ? 'direct' : 'group';
  const title = session.name?.trim() || resolveSessionFallbackTitle(session);
  const updatedLabel = session.updated_at || session.last_message_at
    ? formatSessionTime(session.updated_at ?? session.last_message_at)
    : undefined;

  const memberNames = session.members
    ?.filter((m) => m.member_id !== session.owner_user_id)
    .map((m) => m.member_id);

  return {
    id: sessionId,
    title,
    kind,
    subtitle: session.member_count != null ? `${session.member_count} 人` : undefined,
    updatedLabel,
    avatarLabel: title.slice(0, 2).toUpperCase(),
    ...(session.pinned ? { pinned: true } : {}),
    ...(session.archived ? { archived: true } : {}),
    ...(session.unread_count ? { unreadCount: session.unread_count } : {}),
    ...(memberNames?.length ? { members: memberNames } : {}),
  };
}

function resolveSessionFallbackTitle(session: HubSessionLike): string {
  if (session.type === 'private') return '私聊';
  if (session.title?.trim()) return session.title.trim();
  if (session.name?.trim()) return session.name.trim();
  const sid = session.id || session.session_id || '';
  return sid ? `群会话 ${sid.slice(0, 4)}` : '群会话';
}

function formatSessionTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toLocaleString(appDateLocaleTag(getI18n()?.language), {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  });
}
