/* ═══════════════════════════════════════════════════════════════════════
   DEMO — AgentHub TranscriptBlock[] → ChatView via adapter
   Exercises all major block kinds to verify the adapter pipeline.
   ══════════════════════════════════════════════════════════════════════ */

import type { TranscriptBlock } from '../adapter'

export const demoBlocks: TranscriptBlock[] = [
  // ── User message ──
  {
    id: 'user-1', kind: 'text',
    createdAt: '2026-06-16T14:42:00+08:00',
    author: { id: 'ding', name: 'Ding', role: 'human' },
    text: '帮我把 users 表的 status 改成 ENUM 类型，用 PostgreSQL 原生枚举。',
  },
  // ── Agent text (bubble) ──
  {
    id: 'agent-msg-1', kind: 'text',
    createdAt: '2026-06-16T14:43:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    text: '收到。先确认当前 schema 和所有引用点，再出迁移方案。',
  },
  // ── Run session card ──
  {
    id: 'run-1', kind: 'run_session',
    createdAt: '2026-06-16T14:43:05+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'Status ENUM 迁移',
    status: 'running',
    agentLabel: 'Claude Code',
    runtimeLabel: 'Node.js 22',
  },
  // ── Thinking ──
  {
    id: 'think-1', kind: 'thinking',
    createdAt: '2026-06-16T14:43:10+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    content: '当前 status 为 VARCHAR(20)，值域 active/inactive/banned。需要创建 PostgreSQL 自定义 ENUM 类型，兼容现有数据。涉及文件：model 定义、API handler 校验、迁移脚本。',
    isThinking: true,
  },
  // ── Tool calls ──
  {
    id: 'tool-1', kind: 'tool_call',
    createdAt: '2026-06-16T14:43:30+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    toolName: 'Grep', status: 'running',
    summary: '搜索 status 字段所有引用',
  },
  {
    id: 'tool-r1', kind: 'tool_result',
    createdAt: '2026-06-16T14:43:35+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    toolName: 'Grep', status: 'completed',
    summary: '12 处匹配 · 5 个文件 · model + handler + 3 处业务引用',
  },
  {
    id: 'tool-2', kind: 'tool_call',
    createdAt: '2026-06-16T14:44:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    toolName: 'Read', status: 'running',
  },
  {
    id: 'tool-r2', kind: 'tool_result',
    createdAt: '2026-06-16T14:44:05+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    toolName: 'Read', status: 'completed',
    summary: 'src/models/user.ts · 142 行 · status: string → 需改 @Column',
  },
  // ── Thinking done ──
  {
    id: 'think-2', kind: 'thinking',
    createdAt: '2026-06-16T14:44:30+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    content: '确认改动范围：1) 新建 migration 003 创建 ENUM 类型 2) 更新 user.ts 模型 @Column 3) 更新 API handler @IsEnum 校验。三个文件，可并行执行。',
    isThinking: false,
  },
  // ── File changes ──
  {
    id: 'file-1', kind: 'file_change',
    createdAt: '2026-06-16T14:45:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    path: 'migrations/003_add_status_enum.sql', action: 'create', additions: 2,
  },
  {
    id: 'file-2', kind: 'file_change',
    createdAt: '2026-06-16T14:45:10+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    path: 'src/models/user.ts', action: 'modify', additions: 5, deletions: 3,
  },
  // ── Bubble text ──
  {
    id: 'agent-msg-2', kind: 'text',
    createdAt: '2026-06-16T14:46:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    text: '迁移脚本和模型已更新。Linter 通过。需要审批后继续。',
  },
  // ── Approval ──
  {
    id: 'approval-1', kind: 'approval',
    createdAt: '2026-06-16T14:46:10+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: '部署/写入审批', status: 'pending',
    reason: '修改 2 个文件：migrations/003.sql + src/models/user.ts',
  },
  // ── User approves ──
  {
    id: 'user-2', kind: 'text',
    createdAt: '2026-06-16T14:47:00+08:00',
    author: { id: 'ding', name: 'Ding', role: 'human' },
    text: '批准，继续。',
  },
  // ── Agent continues ──
  {
    id: 'agent-msg-3', kind: 'text',
    createdAt: '2026-06-16T14:48:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    text: '审批通过。正在部署预览。',
  },
  // ── Agent timeline (flattened to think cards) ──
  {
    id: 'timeline-1', kind: 'agent_timeline',
    createdAt: '2026-06-16T14:48:40+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: '运行时间线',
    items: [
      { status: 'completed', label: '初始化会话', detail: '模型、工具权限已加载' },
      { status: 'completed', label: '代码定位', detail: '找到 3 个需要修改的文件' },
      { status: 'completed', label: '迁移脚本', detail: 'migrations/003.sql 已创建' },
      { status: 'running', label: '部署预览', detail: '等待审批...' },
    ],
  },
  // ── Artifact ──
  {
    id: 'artifact-1', kind: 'artifact',
    createdAt: '2026-06-16T14:48:50+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'migration-plan.md', path: 'docs/migration-plan.md',
    action: 'created', artifactKind: 'markdown',
  },
  // ── Sub-agent ──
  {
    id: 'subagent-1', kind: 'subagent',
    createdAt: '2026-06-16T14:49:10+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: 'Linter 检查', worker: 'Linter', status: 'completed',
    summary: '0 errors, 0 warnings — 全部通过',
  },
  // ── Failure (error recovery test) ──
  {
    id: 'failure-1', kind: 'failure',
    createdAt: '2026-06-16T14:49:20+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: '部署失败', reason: 'preview.agenthub.dev 端口 443 超时 — 网络不可达',
  },
  // ── Deploy ──
  {
    id: 'deploy-1', kind: 'deploy',
    createdAt: '2026-06-16T14:48:30+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    status: 'done', url: 'https://preview.agenthub.dev/deploy-af3b21',
  },
  // ── Context usage ──
  {
    id: 'ctx-1', kind: 'context_usage',
    createdAt: '2026-06-16T14:48:35+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    inputTokens: 68400, outputTokens: 2100, usagePercent: 42,
    contextLimit: 200000, modelLabel: 'Claude Sonnet 4.6',
  },
  // ── Route decision (simplified) ──
  {
    id: 'route-1', kind: 'route_decision',
    createdAt: '2026-06-16T14:49:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    action: '分派审查', summary: '已将变更提交给 Reviewer 进行安全审查。',
    targetAgent: 'Reviewer',
  },
  // ── Final bubble ──
  {
    id: 'agent-msg-4', kind: 'text',
    createdAt: '2026-06-16T14:50:00+08:00',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    text: '全部完成。迁移脚本 + 模型 + handler 已更新，Reviewer 已分派。`pnpm test` 12/12 通过。',
  },
]
