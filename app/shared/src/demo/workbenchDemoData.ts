import type { FileItem, TaskItem } from '../workbench/inspector';

export const demoOverviewTasks: TaskItem[] = [
  { label: '梳理现有会话表与消息索引', status: 'done' },
  { label: '确认 FTS5 搜索字段边界', status: 'done' },
  { label: '生成迁移顺序与回滚脚本', status: 'active' },
  { label: '补充性能验证清单', status: 'todo' },
];

export const demoOverviewFiles: FileItem[] = [
  { name: 'sqlite-migration-plan.md', type: 'sql', isPrimary: true },
  { name: 'migrations/0007_chat_threads.sql', type: 'db' },
  { name: 'hooks/useThreadNavigation.ts', type: 'ts' },
  { name: 'B0-SQLITE-RISKS.md', type: 'md' },
];

export const demoFileContents: Record<string, string> = {
  'sqlite-migration-plan.md': `# B0 SQLite 迁移方案

## 目标
- 新增 thread/message 索引，保持现有会话可回滚。
- 使用 FTS5 支持本地消息搜索。
- 迁移脚本必须可以重复执行并输出校验摘要。

## 顺序
1. 备份当前 SQLite 数据库。
2. 创建 chat_threads 与 message_search 虚表。
3. 回填历史消息索引。
4. 写入 migration_state 并生成校验报告。`,
  'migrations/0007_chat_threads.sql': `BEGIN;

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS message_search
USING fts5(thread_id, author, body);

COMMIT;`,
  'hooks/useThreadNavigation.ts': `export function useThreadNavigation(threadId: string) {
  return {
    activeThreadId: threadId,
    openThread: (next: string) => next,
  };
}`,
  'B0-SQLITE-RISKS.md': `# B0 SQLite 风险

- 回滚脚本必须覆盖索引表与迁移状态。
- FTS5 字段只保存可搜索摘要。
- 导航 hook 不能改变现有 thread id。`,
};

export const demoFileDiffs: Record<string, string> = {
  'sqlite-migration-plan.md': [
    'diff --git a/sqlite-migration-plan.md b/sqlite-migration-plan.md',
    '--- a/sqlite-migration-plan.md',
    '+++ b/sqlite-migration-plan.md',
    '@@ -0,0 +1,14 @@',
    '+# B0 SQLite 迁移方案',
    '+## 目标',
    '+- 新增 thread/message 索引，保持现有会话可回滚。',
    '+- 使用 FTS5 支持本地消息搜索。',
    '+- 迁移脚本必须可以重复执行并输出校验摘要。',
  ].join('\n'),
  'migrations/0007_chat_threads.sql': [
    'diff --git a/migrations/0007_chat_threads.sql b/migrations/0007_chat_threads.sql',
    '--- a/migrations/0007_chat_threads.sql',
    '+++ b/migrations/0007_chat_threads.sql',
    '@@ -0,0 +1,12 @@',
    '+BEGIN;',
    '+CREATE TABLE IF NOT EXISTS chat_threads (',
    '+  id TEXT PRIMARY KEY,',
    '+  title TEXT NOT NULL,',
    '+  updated_at INTEGER NOT NULL',
    '+);',
    '+CREATE VIRTUAL TABLE IF NOT EXISTS message_search',
    '+USING fts5(thread_id, author, body);',
    '+COMMIT;',
  ].join('\n'),
};

export function getDemoFileContent(file: FileItem): string {
  return demoFileContents[file.name] ?? `${file.name}\n\n只读预览内容等待平台 adapter 提供。`;
}

export function getDemoFileDiff(file: FileItem): string | undefined {
  return demoFileDiffs[file.name];
}

export function findDemoFileByName(name: string): FileItem {
  return demoOverviewFiles.find((file) => file.name === name) ?? {
    name,
    type: fileTypeFromName(name),
  };
}

function fileTypeFromName(name: string): FileItem['type'] {
  if (name.endsWith('.md')) return 'md';
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'ts';
  if (name.endsWith('.sql') || name.endsWith('.db')) return 'db';
  return 'txt';
}
