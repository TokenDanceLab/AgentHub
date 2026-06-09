/**
 * Shared data mapping: Hub API types → Workbench UI types.
 *
 * Used by both Web (useWebWorkbenchModel) and Desktop (useDesktopWorkbenchModel)
 * to convert Hub REST responses into the presentational types consumed by
 * shared workbench pages.
 *
 * Extracted from app/web/src/platform/useWebWorkbenchModel.ts to avoid drift.
 */

import type { ContactMember, ProjectInfo } from './pages';
import type { WorkbenchContactsData } from './pages/ContactsPage';
import type { DocRow } from './pages/DocsPage';
import {
  isWorkbenchRealDataMode,
  isWorkbenchFixtureDataMode,
  type WorkbenchDataMode,
} from '../demo';

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
): WorkbenchContactsData | undefined {
  if (!hubReady) {
    return isWorkbenchRealDataMode(dataMode) ? hubEmptyContacts : undefined;
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
  created_at?: string;
  updated_at?: string;
}

export function resolveHubProjects<TProject extends HubWorkspaceProjectLike>(
  projects: TProject[] | undefined,
  hubReady: boolean,
  dataMode: WorkbenchDataMode,
  mapFn: (project: TProject) => ProjectInfo,
): ProjectInfo[] | undefined {
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
  return {
    id: doc.id,
    title: doc.title?.trim() || '未命名文档',
    tag: doc.tag?.trim() || undefined,
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
): DocRow[] | undefined {
  if (!hubReady) {
    return isWorkbenchFixtureDataMode(dataMode) ? undefined : [];
  }
  return (documents ?? []).filter((doc) => doc.status !== 'deleted').map(hubDocumentToDocRow);
}
