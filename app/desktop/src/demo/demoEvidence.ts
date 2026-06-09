/**
 * Per-conversation demo evidence data for the right sidebar.
 * Used when Edge is unavailable and the app falls back to JS demo mode.
 * Each conversation gets its own tasks, files, and preview — no two pages are the same.
 */
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';

/* ═══ Builder ═══ */
const builderEvidence: RuntimeEvidenceSnapshot = {
  runId: 'run-builder-1',
  diffs: [
    makeDiff('sqlite-migration-plan.md', 'added', 14, 0, [
      '# B0 SQLite 迁移方案',
      '## 目标',
      '- 新增 thread/message 索引，保持现有会话可回滚。',
      '- 使用 FTS5 支持本地消息搜索。',
      '- 迁移脚本必须可以重复执行并输出校验摘要。',
    ]),
    makeDiff('migrations/0007_chat_threads.sql', 'added', 10, 0, [
      'BEGIN;',
      'CREATE TABLE IF NOT EXISTS chat_threads (',
      '  id TEXT PRIMARY KEY,',
      '  title TEXT NOT NULL,',
      '  updated_at INTEGER NOT NULL',
      ');',
      'CREATE VIRTUAL TABLE IF NOT EXISTS message_search',
      'USING fts5(thread_id, author, body);',
      'COMMIT;',
    ]),
    makeDiff('hooks/useThreadNavigation.ts', 'added', 8, 0, [
      "export function useThreadNavigation(threadId: string) {",
      "  return {",
      "    activeThreadId: threadId,",
      "    openThread: (next: string) => next,",
      "  };",
      "}",
    ]),
  ],
  artifacts: [
    { id: 'a1', runId: 'run-builder-1', threadId: 'builder', kind: 'markdown', path: 'sqlite-migration-plan.md', sizeBytes: 520, createdAt: '2026-06-10T14:49:00Z' },
    { id: 'a2', runId: 'run-builder-1', threadId: 'builder', kind: 'sql', path: 'migrations/0007_chat_threads.sql', sizeBytes: 340, createdAt: '2026-06-10T14:49:00Z' },
    { id: 'a3', runId: 'run-builder-1', threadId: 'builder', kind: 'ts', path: 'hooks/useThreadNavigation.ts', sizeBytes: 180, createdAt: '2026-06-10T14:49:00Z' },
    { id: 'a4', runId: 'run-builder-1', threadId: 'builder', kind: 'md', path: 'B0-SQLITE-RISKS.md', sizeBytes: 290, createdAt: '2026-06-10T14:49:00Z' },
  ],
  previews: [
    { id: 'p1', runId: 'run-builder-1', threadId: 'builder', url: '/demo-preview.html', status: 'ready', createdAt: '2026-06-10T14:49:00Z' },
  ],
};

/* ═══ Agent 协作群 ═══ */
const agentCollabEvidence: RuntimeEvidenceSnapshot = {
  runId: 'run-collab-1',
  diffs: [
    makeDiff('src/orchestrator/dispatch.ts', 'modified', 12, 3, [
      'dispatch: 按子任务类型分派到对应 Agent',
      '新增 Builder / Reviewer / Deployer 路由逻辑',
    ]),
  ],
  artifacts: [
    { id: 'c1', runId: 'run-collab-1', threadId: 'agent-collab', kind: 'ts', path: 'src/orchestrator/dispatch.ts', sizeBytes: 2400, createdAt: '2026-06-10T14:58:00Z' },
    { id: 'c2', runId: 'run-collab-1', threadId: 'agent-collab', kind: 'json', path: 'reports/agent-status.json', sizeBytes: 860, createdAt: '2026-06-10T14:58:00Z' },
  ],
  previews: [],
};

/* ═══ ByteDance TeamRun ═══ */
const teamRunEvidence: RuntimeEvidenceSnapshot = {
  runId: 'run-teamrun-1',
  diffs: [
    makeDiff('fixture/evidence-capture.json', 'added', 25, 0, [
      'TeamRun fixture evidence capture schema',
      'Records per-step artifacts from parallel agent execution',
    ]),
  ],
  artifacts: [
    { id: 't1', runId: 'run-teamrun-1', threadId: 'bytedance-teamrun', kind: 'json', path: 'fixture/evidence-capture.json', sizeBytes: 4200, createdAt: '2026-06-10T10:11:00Z' },
  ],
  previews: [
    { id: 'tp1', runId: 'run-teamrun-1', threadId: 'bytedance-teamrun', url: '/demo-preview.html', status: 'ready', createdAt: '2026-06-10T10:11:00Z' },
  ],
};

/* ═══ Deployer ═══ */
const deployerEvidence: RuntimeEvidenceSnapshot = {
  runId: 'run-deployer-1',
  diffs: [
    makeDiff('Dockerfile', 'modified', 5, 2, [
      'FROM node:20-alpine',
      'COPY --from=build /app/dist ./dist',
    ]),
    makeDiff('nginx/default.conf', 'added', 15, 0, [
      'server { listen 80; root /app/dist; }',
    ]),
  ],
  artifacts: [
    { id: 'd1', runId: 'run-deployer-1', threadId: 'deployer', kind: 'dockerfile', path: 'Dockerfile', sizeBytes: 680, createdAt: '2026-06-10T14:48:00Z' },
    { id: 'd2', runId: 'run-deployer-1', threadId: 'deployer', kind: 'conf', path: 'nginx/default.conf', sizeBytes: 420, createdAt: '2026-06-10T14:48:00Z' },
  ],
  previews: [
    { id: 'dp1', runId: 'run-deployer-1', threadId: 'deployer', url: '/demo-preview.html', status: 'ready', createdAt: '2026-06-10T14:48:00Z' },
  ],
};

/* ═══ Orchestrator ═══ */
const orchestratorEvidence: RuntimeEvidenceSnapshot = {
  runId: 'run-orchestrator-1',
  diffs: [
    makeDiff('plans/sprint-07.md', 'added', 30, 0, [
      '# Sprint 07 计划',
      '- Builder: B0 SQLite 迁移',
      '- Reviewer: 代码审查',
      '- Deployer: 静态预览部署',
    ]),
  ],
  artifacts: [
    { id: 'o1', runId: 'run-orchestrator-1', threadId: 'orchestrator', kind: 'md', path: 'plans/sprint-07.md', sizeBytes: 1800, createdAt: '2026-06-10T14:32:00Z' },
  ],
  previews: [],
};

/* ═══ Reviewer ═══ */
const reviewerEvidence: RuntimeEvidenceSnapshot = {
  runId: 'run-reviewer-1',
  diffs: [
    makeDiff('reviews/builder-pr-03.md', 'added', 22, 0, [
      '# Builder PR-03 审查',
      '## 结论：通过',
      '- 0 个阻塞项',
      '- 2 个建议（非阻塞）',
    ]),
  ],
  artifacts: [
    { id: 'r1', runId: 'run-reviewer-1', threadId: 'reviewer', kind: 'md', path: 'reviews/builder-pr-03.md', sizeBytes: 1200, createdAt: '2026-06-10T12:15:00Z' },
  ],
  previews: [],
};

/* ═══ Johnny — 私聊，无 run ═══ */

/* ═══ Trump — 文档反馈，轻量 ═══ */
const trumpEvidence: RuntimeEvidenceSnapshot = {
  runId: 'run-trump-1',
  diffs: [],
  artifacts: [
    { id: 'tr1', runId: 'run-trump-1', threadId: 'trump', kind: 'doc', path: 'docs/cloud-list-feedback.md', sizeBytes: 560, createdAt: '2026-06-10T10:18:00Z' },
  ],
  previews: [],
};

/* ═══ AI 游戏项目 ═══ */
const projectAiEvidence: RuntimeEvidenceSnapshot = {
  runId: 'run-project-ai-1',
  diffs: [
    makeDiff('game/scene-manager.ts', 'modified', 18, 4, [
      '重构场景管理器，支持动态加载',
      '新增 preloadScene / unloadScene 方法',
    ]),
    makeDiff('game/asset-pipeline.ts', 'added', 20, 0, [
      '资源管线 v2：支持并行纹理加载',
    ]),
  ],
  artifacts: [
    { id: 'ai1', runId: 'run-project-ai-1', threadId: 'project-ai', kind: 'ts', path: 'game/scene-manager.ts', sizeBytes: 3400, createdAt: '2026-06-04T18:00:00Z' },
    { id: 'ai2', runId: 'run-project-ai-1', threadId: 'project-ai', kind: 'ts', path: 'game/asset-pipeline.ts', sizeBytes: 2800, createdAt: '2026-06-04T18:00:00Z' },
  ],
  previews: [
    { id: 'aip1', runId: 'run-project-ai-1', threadId: 'project-ai', url: '/demo-preview.html', status: 'ready', createdAt: '2026-06-04T18:00:00Z' },
  ],
};

/* ═══ 文档重构 ═══ */
const projectDocsEvidence: RuntimeEvidenceSnapshot = {
  runId: 'run-project-docs-1',
  diffs: [
    makeDiff('docs/README.md', 'modified', 8, 2, [
      '更新 README 结构，新增快速入门章节',
    ]),
    makeDiff('docs/api-reference.md', 'added', 40, 0, [
      '新增 API 参考文档，覆盖所有公开接口',
    ]),
  ],
  artifacts: [
    { id: 'wd1', runId: 'run-project-docs-1', threadId: 'project-docs', kind: 'md', path: 'docs/README.md', sizeBytes: 2400, createdAt: '2026-06-02T16:00:00Z' },
    { id: 'wd2', runId: 'run-project-docs-1', threadId: 'project-docs', kind: 'md', path: 'docs/api-reference.md', sizeBytes: 6800, createdAt: '2026-06-02T16:00:00Z' },
  ],
  previews: [],
};

/* ═══ Lookup map ═══ */

const demoEvidenceByConversation: Record<string, RuntimeEvidenceSnapshot> = {
  builder: builderEvidence,
  'agent-collab': agentCollabEvidence,
  'bytedance-teamrun': teamRunEvidence,
  deployer: deployerEvidence,
  orchestrator: orchestratorEvidence,
  reviewer: reviewerEvidence,
  trump: trumpEvidence,
  'project-ai': projectAiEvidence,
  'project-docs': projectDocsEvidence,
};

/**
 * Returns synthetic runtime evidence for the given conversation in demo mode.
 * Returns undefined if the conversation has no demo evidence (e.g. private chat).
 */
export function getDemoRuntimeEvidence(conversationId: string | undefined): RuntimeEvidenceSnapshot | undefined {
  if (!conversationId) return undefined;
  return demoEvidenceByConversation[conversationId];
}

/* ═══ Helpers ═══ */

function makeDiff(
  filePath: string,
  status: 'added' | 'deleted' | 'modified' | 'untracked',
  additions: number,
  deletions: number,
  previewLines: string[],
) {
  return {
    filePath,
    status,
    additions,
    deletions,
    hunks: [
      {
        header: `@@ -0,0 +1,${additions} @@`,
        lines: previewLines.map((content) => ({
          type: status === 'deleted' ? 'deleted' as const : 'added' as const,
          content,
        })),
      },
    ],
  };
}
