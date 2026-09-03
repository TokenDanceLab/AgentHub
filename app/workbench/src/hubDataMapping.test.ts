import { describe, expect, it } from 'vitest';
import {
  contactInfoToMember,
  hubDocumentToDocRow,
  hubEmptyContacts,
  hubSessionToConversation,
  resolveHubContacts,
  resolveHubDocuments,
  resolveHubProjects,
  workspaceProjectToProjectInfo,
} from './hubDataMapping';

/* ═══════════════════════════════════════════════════════════════════════
   hubDataMapping — Hub API types → Workbench UI types.

   Desktop 的 workbench model 通过这些共享函数做 Hub→UI 映射（`resolveHubProjects`
   + `workspaceProjectToProjectInfo`），所以映射契约在这里测一次。Web 侧目前
   走自己的副本 `app/web/src/platform/webWorkbenchProjects.ts`（分岔已登记，
   收敛属另一批）。原 #1546 的两个 platform projects port 已删：它们在两个
   shell 里都结构性不可达。
   ═══════════════════════════════════════════════════════════════════════ */

// Deterministic helpers: formatDocTime / formatProjectDate / formatSessionTime
// all derive "today/yesterday" from the current clock, so fixtures are
// expressed as offsets from Date.now().
const now = Date.now();
const minutesAgo = (minutes: number) => new Date(now - minutes * 60 * 1000).toISOString();
const hoursAgo = (hours: number) => new Date(now - hours * 60 * 60 * 1000).toISOString();
const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

describe('contactInfoToMember', () => {
  it('prefers remark over nickname/username and derives initials from the name', () => {
    const member = contactInfoToMember({
      user_id: 'u-1',
      username: 'john',
      nickname: 'Johnny',
      remark: '  John Smith  ',
      online: true,
    });

    expect(member).toMatchObject({
      id: 'u-1',
      name: 'John Smith',
      initials: 'JS',
      org: 'TokenDance',
      status: '在线',
      tag: 'Hub',
    });
  });

  it('marks external contacts with the external org/tag and offline status', () => {
    const member = contactInfoToMember({
      user_id: 'u-2',
      nickname: '外部伙伴',
      type: 'external',
      online: false,
    });

    expect(member).toMatchObject({
      org: '外部联系人',
      status: '离线',
      tag: 'External',
      initials: '外部',
    });
  });

  it('falls back through nickname/username to the raw user id', () => {
    expect(contactInfoToMember({ user_id: 'u-3', nickname: 'Nicky' }).name).toBe('Nicky');
    expect(contactInfoToMember({ user_id: 'u-4', username: 'uname' }).name).toBe('uname');
    expect(contactInfoToMember({ user_id: 'u-5' }).name).toBe('u-5');
  });

  it('keeps a single-word ascii name initial and the first two CJK chars', () => {
    expect(contactInfoToMember({ user_id: 'u-6', nickname: 'john' }).initials).toBe('J');
    expect(contactInfoToMember({ user_id: 'u-7', nickname: '中文' }).initials).toBe('中文');
    expect(contactInfoToMember({ user_id: '', nickname: '   ' }).initials).toBe('U');
  });
});

describe('resolveHubContacts', () => {
  it('returns undefined in fixture/mock mode while the hub is not ready', () => {
    expect(resolveHubContacts(undefined, false, 'fixture')).toBeUndefined();
    expect(resolveHubContacts(undefined, false, 'mock')).toBeUndefined();
  });

  it('returns the empty contacts contract in real modes while the hub is not ready', () => {
    expect(resolveHubContacts(undefined, false, 'auto')).toEqual(hubEmptyContacts);
    expect(resolveHubContacts(undefined, false, 'approved-real')).toEqual(hubEmptyContacts);
  });

  it('maps members and derives starred contacts and recent shortcuts when ready', () => {
    const result = resolveHubContacts(
      [
        { user_id: 'u-1', nickname: 'Alice' },
        { user_id: 'u-2', nickname: 'Bob' },
        { user_id: 'u-3', nickname: 'Carol' },
        { user_id: 'u-4', nickname: 'Dave' },
      ],
      true,
      'auto',
    );

    expect(result?.members).toHaveLength(4);
    expect(result?.starredContacts?.map((m) => m.id)).toEqual(['u-1', 'u-2']);
    expect(result?.recentShortcuts).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('keeps the empty collections when ready with no contacts', () => {
    const result = resolveHubContacts(undefined, true, 'auto');
    expect(result?.members).toEqual([]);
    expect(result?.starredContacts).toEqual([]);
    expect(result?.recentShortcuts).toEqual([]);
  });
});

describe('workspaceProjectToProjectInfo', () => {
  it('maps id/name/description and defaults the description', () => {
    const info = workspaceProjectToProjectInfo({
      id: 'p1',
      name: 'Alpha',
      description: '  Desc  ',
    });

    expect(info).toMatchObject({
      id: 'p1',
      name: 'Alpha',
      description: 'Desc',
      status: 'Active',
      meta: 'Hub project',
      members: [],
      runs: [],
      artifacts: [],
      feed: [],
    });
  });

  it('trims the name and falls back to the default project name', () => {
    const info = workspaceProjectToProjectInfo({ id: 'p2', name: '   ' });

    expect(info.name).toBe('未命名项目');
    expect(info.description).toBe('Hub workspace project');
  });

  it('surfaces the creation time in meta when present', () => {
    const info = workspaceProjectToProjectInfo({
      id: 'p3',
      name: 'Gamma',
      created_at: daysAgo(3),
    });

    expect(info.meta.startsWith('Created ')).toBe(true);
  });

  it('keeps the raw created_at in meta when the date is unparseable', () => {
    const info = workspaceProjectToProjectInfo({
      id: 'p4',
      name: 'Delta',
      created_at: 'not-a-date',
    });

    expect(info.meta).toBe('Created not-a-date');
  });
});

describe('resolveHubProjects', () => {
  const mapFn = workspaceProjectToProjectInfo;

  it('returns undefined in fixture/mock mode while the hub is not ready', () => {
    expect(resolveHubProjects([], false, 'fixture', mapFn)).toBeUndefined();
  });

  it('returns an empty list in real modes while the hub is not ready', () => {
    expect(resolveHubProjects(undefined, false, 'auto', mapFn)).toEqual([]);
  });

  it('maps projects through the given mapper when ready', () => {
    const projects = [
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' },
    ];
    const result = resolveHubProjects(projects, true, 'auto', mapFn);
    expect(result?.map((p) => p.name)).toEqual(['Alpha', 'Beta']);
  });

  it('returns an empty list when ready but no projects exist', () => {
    expect(resolveHubProjects(undefined, true, 'auto', mapFn)).toEqual([]);
  });
});

describe('hubDocumentToDocRow', () => {
  it('maps a full document row including the tag badge', () => {
    const row = hubDocumentToDocRow({
      id: 'd-1',
      title: ' 设计稿 ',
      tag: ' 内部 ',
      location: '团队空间',
      owner_id: 'alice',
      updated_at: minutesAgo(5),
    });

    expect(row).toMatchObject({
      id: 'd-1',
      title: '设计稿',
      tag: '内部',
      location: '团队空间',
      owner: 'alice',
    });
    expect(row.time).toContain('今天');
  });

  it('omits the tag when absent or blank and falls back to defaults', () => {
    const row = hubDocumentToDocRow({
      id: 'd-2',
      title: '   ',
      tag: '   ',
      location: '',
      owner_id: '',
    });

    expect(row).toEqual({
      id: 'd-2',
      title: '未命名文档',
      location: '我的文档库',
      owner: 'Hub',
      time: 'Hub',
    });
    expect(row.tag).toBeUndefined();
  });

  it('labels recent edits as yesterday and older edits by date', () => {
    const yesterday = hubDocumentToDocRow({
      id: 'd-3',
      title: 'Doc',
      location: 'L',
      updated_at: hoursAgo(26),
    });
    expect(yesterday.time).toContain('昨天');

    const older = hubDocumentToDocRow({
      id: 'd-4',
      title: 'Doc',
      location: 'L',
      updated_at: daysAgo(10),
    });
    expect(older.time).toMatch(/^\d+月\d+日 \d{2}:\d{2}$/);
  });

  it('prefers updated_at over created_at and keeps raw invalid timestamps', () => {
    const row = hubDocumentToDocRow({
      id: 'd-5',
      title: 'Doc',
      location: 'L',
      created_at: minutesAgo(30),
      updated_at: minutesAgo(3),
    });
    expect(row.time).toContain('今天');

    const invalid = hubDocumentToDocRow({
      id: 'd-6',
      title: 'Doc',
      location: 'L',
      updated_at: 'garbage-date',
    });
    expect(invalid.time).toBe('garbage-date');
  });
});

describe('resolveHubDocuments', () => {
  const docs = [
    { id: 'd-1', title: 'Live', location: 'L' },
    { id: 'd-2', title: 'Trash', location: 'L', status: 'deleted' },
  ];

  it('returns undefined in fixture/mock mode while the hub is not ready', () => {
    expect(resolveHubDocuments(docs, false, 'fixture')).toBeUndefined();
  });

  it('returns an empty list in real modes while the hub is not ready', () => {
    expect(resolveHubDocuments(undefined, false, 'auto')).toEqual([]);
  });

  it('filters out deleted documents and maps the rest when ready', () => {
    const result = resolveHubDocuments(docs, true, 'auto');
    expect(result?.map((d) => d.id)).toEqual(['d-1']);
  });

  it('returns an empty list when ready but no documents exist', () => {
    expect(resolveHubDocuments(undefined, true, 'auto')).toEqual([]);
  });
});

describe('hubSessionToConversation', () => {
  it('maps a private session to a direct conversation', () => {
    const conversation = hubSessionToConversation({
      id: 's-1',
      type: 'private',
      name: ' Alice ',
      owner_user_id: 'me',
      members: [
        { member_id: 'me', role: 'owner' },
        { member_id: 'alice' },
      ],
      member_count: 2,
      unread_count: 3,
      updated_at: '2026-08-04T08:00:00Z',
    });

    expect(conversation).toMatchObject({
      id: 's-1',
      title: 'Alice',
      kind: 'direct',
      subtitle: '2 人',
      avatarLabel: 'AL',
      unreadCount: 3,
      members: ['alice'],
    });
    expect(conversation.updatedLabel).toMatch(/\d{1,2}\/\d{1,2},? \d{1,2}:\d{2}/);
  });

  it('maps a group session with fallback title and session_id', () => {
    const conversation = hubSessionToConversation({
      session_id: 's-2',
      type: 'group',
      title: ' 评审群 ',
      pinned: true,
      archived: true,
      last_message_at: minutesAgo(30),
    });

    expect(conversation).toMatchObject({
      id: 's-2',
      title: '评审群',
      kind: 'group',
      pinned: true,
      archived: true,
      avatarLabel: '评审',
    });
    expect(conversation.subtitle).toBeUndefined();
    expect(conversation.updatedLabel).toMatch(/\d{1,2}\/\d{1,2},? \d{1,2}:\d{2}/);
  });

  it('falls back to 私聊 for private sessions without a name', () => {
    const conversation = hubSessionToConversation({ id: 's-3', type: 'private' });
    expect(conversation.title).toBe('私聊');
    expect(conversation.updatedLabel).toBeUndefined();
    expect(conversation.avatarLabel).toBe('私聊');
  });

  it('falls back to a short group title derived from the session id', () => {
    const withTitle = hubSessionToConversation({ id: 'sess-long-id', type: 'group' });
    expect(withTitle.title).toBe('群会话 sess');

    const noId = hubSessionToConversation({ type: 'group' } as never);
    expect(noId.title).toBe('群会话');
    expect(noId.id).toBe('');
  });

  it('drops unparseable update timestamps and keeps members only when present', () => {
    const conversation = hubSessionToConversation({
      id: 's-4',
      type: 'group',
      title: 'G',
      updated_at: 'garbage-date',
    });

    expect(conversation.updatedLabel).toBeUndefined();
    expect(conversation.members).toBeUndefined();
  });
});
