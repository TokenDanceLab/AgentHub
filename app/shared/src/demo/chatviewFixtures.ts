/* ═══════════════════════════════════════════════════════════════════════
   CHATVIEW FIXTURES — TranscriptBlock[] for demo conversations
   Data-driven mock — zero hardcoded UI strings in components.
   Wired into resolveDemoWorkbenchTranscript via demoWorkbenchTranscripts.
   ══════════════════════════════════════════════════════════════════════ */

import type { TranscriptBlock } from '../transcript/types'

const TS = '2026-06-17T14:30:00+08:00'
const T = (offsetMin: number) => {
  const d = new Date('2026-06-17T14:30:00+08:00')
  d.setMinutes(d.getMinutes() + offsetMin)
  return d.toISOString()
}

const B = (id: string, name = 'Builder') => ({ id, name, role: 'agent' as const })
const U = (id: string, name = 'Ding') => ({ id, name, role: 'human' as const })

// ═══════════════════════════════════════════════════════════════════════
// Builder DM — rich ReAct: think → tool → file → sub → approval → deploy
// ═══════════════════════════════════════════════════════════════════════

export const chatviewBuilderTranscript: TranscriptBlock[] = [
  { id: 'bu1', kind: 'text', createdAt: T(0), author: U('ding'), text: '把 users 表的 status 改成 ENUM 类型，用 PostgreSQL 原生枚举' },
  { id: 'ba1', kind: 'text', createdAt: T(1), author: B('builder'), text: '收到。先确认当前 schema 和所有引用点，再出迁移方案。', displayTitle: '确认任务', displayDetail: '先确认当前 schema 和所有引用点，再出迁移方案。' },
  {
    id: 'bth1', kind: 'thinking', createdAt: T(2), author: B('builder'),
    content: '用户要把 status 改成枚举。当前 schema 中 status 为 VARCHAR(20)，值域 active/inactive/banned。需要创建 PostgreSQL 自定义 ENUM 类型，兼容现有数据。涉及文件：model 定义、API handler 校验、迁移脚本。',
    isThinking: true,
  },
  { id: 'bto1', kind: 'tool_call', createdAt: T(3), author: B('builder'), toolName: 'Read', status: 'running' },
  { id: 'btr1', kind: 'tool_result', createdAt: T(4), author: B('builder'), toolName: 'Read', status: 'completed', summary: 'src/models/user.ts · 142 行 · status 字段当前为 VARCHAR(20)' },
  { id: 'bto2', kind: 'tool_call', createdAt: T(5), author: B('builder'), toolName: 'Grep', status: 'running' },
  { id: 'btr2', kind: 'tool_result', createdAt: T(6), author: B('builder'), toolName: 'Grep', status: 'completed', summary: 'src/ → "status" · 12 匹配 · 5 文件 · model + handler + 3 处业务引用' },
  {
    id: 'bth2', kind: 'thinking', createdAt: T(7), author: B('builder'),
    content: 'VARCHAR(20)，值 active/inactive/banned。创建迁移脚本 003，更新 user.ts 模型，更新 API handler 类型守卫。三个文件改动范围可控。',
    isThinking: false,
  },
  {
    id: 'bf1', kind: 'file_change', createdAt: T(8), author: B('builder'),
    path: 'migrations/003_add_status_enum.sql', action: 'created', additions: 2,
    patch: "+ CREATE TYPE user_status AS ENUM ('active', 'inactive', 'banned');\n+ ALTER TABLE users ALTER COLUMN status TYPE user_status USING status::user_status;",
  },
  {
    id: 'bf2', kind: 'file_change', createdAt: T(9), author: B('builder'),
    path: 'src/models/user.ts', action: 'modified', additions: 5, deletions: 3,
    patch: '-   @Column({ type: \'varchar\', length: 20 })\n-   status: string;\n+   @Column({ type: \'enum\', enum: UserStatus })\n+   status: UserStatus;',
  },
  {
    id: 'bf3', kind: 'file_change', createdAt: T(10), author: B('builder'),
    path: 'src/handlers/user.ts', action: 'modified', additions: 4, deletions: 3,
    patch: '-   @IsString()\n-   @IsIn([\'active\', \'inactive\', \'banned\'])\n-   status: string;\n+   @IsEnum(UserStatus)\n+   status: UserStatus;',
  },
  {
    id: 'bsub1', kind: 'subagent', createdAt: T(11), author: B('builder'),
    title: 'Linter 检查', worker: 'Linter', status: 'completed',
    summary: '0 errors, 0 warnings · eslint + prettier + tsc 全部通过',
  },
  {
    id: 'bsub2', kind: 'subagent', createdAt: T(12), author: B('builder'),
    title: '安全检查', worker: 'SecurityAuditor', status: 'completed',
    summary: '审计完成：0 漏洞，0 风险项。ENUM 迁移安全，权限模型无变更。',
  },
  {
    id: 'bsub3', kind: 'subagent', createdAt: T(13), author: B('builder'),
    title: '文档生成', worker: 'DocGenerator', status: 'completed',
    summary: 'CHANGELOG.md 已更新 · API 文档已同步',
  },
  { id: 'ba2', kind: 'text', createdAt: T(14), author: B('builder'), text: '改动完成。迁移脚本和模型定义已更新，Linter 和安全审计均通过。需要审批后继续。', displayTitle: '改动完成', displayDetail: '迁移脚本和模型定义已更新，Linter 和安全审计均通过。' },
  {
    id: 'bap1', kind: 'approval', createdAt: T(15), author: B('builder'),
    title: '部署/写入审批', status: 'pending',
    reason: 'Builder 请求修改 3 个文件。需要确认后继续。',
  },
  { id: 'bu2', kind: 'text', createdAt: T(16), author: U('ding'), text: '批准，继续' },
  { id: 'ba3', kind: 'text', createdAt: T(17), author: B('builder'), text: '审批通过。正在部署预览。' },
  {
    id: 'bdep1', kind: 'deploy', createdAt: T(18), author: B('builder'),
    runId: 'run_builder_001', status: 'deployed', url: 'https://preview.example.com/deploy-af3b21',
  },
  {
    id: 'bctx1', kind: 'context_usage', createdAt: T(19), author: B('builder'),
    inputTokens: 68400, outputTokens: 2100, usagePercent: 42,
    contextLimit: 200000, modelLabel: 'Claude Sonnet 4',
  },
  { id: 'ba4', kind: 'text', createdAt: T(20), author: B('builder'), text: '全部完成。迁移脚本 + 模型 + handler 已更新，测试 12/12 通过。' },
]

// ═══════════════════════════════════════════════════════════════════════
// Agent Collab Group — multi-agent: Builder → Orchestrator → Reviewer → QA
// ═══════════════════════════════════════════════════════════════════════

const O = (id: string) => ({ id, name: 'Orchestrator', role: 'agent' as const })
const R = (id: string) => ({ id, name: 'Reviewer', role: 'agent' as const })
const Q = (id: string) => ({ id, name: 'QA', role: 'agent' as const })

export const chatviewAgentCollabTranscript: TranscriptBlock[] = [
  { id: 'gu1', kind: 'text', createdAt: T(0), author: U('ding'), text: '@Orchestrator 把 users 表的 status 改成 ENUM 类型，安排一下' },

  // ── Orchestrator ReAct ──
  {
    id: 'goth1', kind: 'thinking', createdAt: T(1), author: O('orch'),
    content: '@Ding 要求把 users 表的 status 从 VARCHAR 改成 ENUM。先了解项目结构，找到相关文件，确认改动范围。',
    isThinking: true,
  },
  { id: 'goto1', kind: 'tool_call', createdAt: T(2), author: O('orch'), toolName: 'Read', status: 'running' },
  { id: 'gotr1', kind: 'tool_result', createdAt: T(3), author: O('orch'), toolName: 'Read', status: 'completed', summary: 'src/models/user.ts · 142 行 · status 字段当前为 VARCHAR(20)' },
  { id: 'goto2', kind: 'tool_call', createdAt: T(4), author: O('orch'), toolName: 'Grep', status: 'running' },
  { id: 'gotr2', kind: 'tool_result', createdAt: T(5), author: O('orch'), toolName: 'Grep', status: 'completed', summary: 'src/ → "status" · 12 匹配 · 5 文件 · model + handler + 3 处引用' },
  {
    id: 'goth2', kind: 'thinking', createdAt: T(6), author: O('orch'),
    content: '改动涉及 3 处：model 定义改 @Column、handler 校验改 @IsEnum、需新建迁移脚本。拆 3 个子任务：Builder 负责实现，Reviewer 负责审查，QA 总体验收。Builder 与 Reviewer 可并行。',
    isThinking: false,
  },
  {
    id: 'gort1', kind: 'route_decision', createdAt: T(7), author: O('orch'),
    action: '拆解完成 · 并行 + 串行', summary: '两阶段：Builder + Reviewer 并行实现与审查 → QA 串行总体验收。',
    targetAgent: 'Builder, Reviewer → QA',
  },
  { id: 'go1', kind: 'text', createdAt: T(8), author: O('orch'), text: '分析完成。拆解为 2 阶段：Builder + Reviewer 并行 → QA 总体验收。', displayDetail: '拆解为 2 阶段：Builder + Reviewer 并行 → QA 总体验收。' },

  // ── Builder ──
  {
    id: 'gbth1', kind: 'thinking', createdAt: T(9), author: B('builder2'),
    content: 'VARCHAR(20)，现有值 active/inactive/banned。创建迁移脚本，更新模型定义，更新 API handler 类型守卫。',
    isThinking: true,
  },
  { id: 'gbto1', kind: 'tool_call', createdAt: T(10), author: B('builder2'), toolName: 'Read', status: 'running' },
  { id: 'gbtr1', kind: 'tool_result', createdAt: T(11), author: B('builder2'), toolName: 'Read', status: 'completed', summary: 'src/models/user.ts · 142 行' },
  { id: 'gbto2', kind: 'tool_call', createdAt: T(12), author: B('builder2'), toolName: 'Read', status: 'running' },
  { id: 'gbtr2', kind: 'tool_result', createdAt: T(13), author: B('builder2'), toolName: 'Read', status: 'completed', summary: 'src/handlers/user.ts · 89 行' },
  {
    id: 'gbf1', kind: 'file_change', createdAt: T(14), author: B('builder2'),
    path: 'migrations/003_add_status_enum.sql', action: 'created', additions: 2,
  },
  {
    id: 'gbf2', kind: 'file_change', createdAt: T(15), author: B('builder2'),
    path: 'src/models/user.ts', action: 'modified', additions: 5, deletions: 3,
  },
  {
    id: 'gbf3', kind: 'file_change', createdAt: T(16), author: B('builder2'),
    path: 'src/handlers/user.ts', action: 'modified', additions: 4, deletions: 3,
  },
  { id: 'gb1', kind: 'text', createdAt: T(17), author: B('builder2'), text: '迁移脚本、模型定义和 API handler 已全部更新。', displayDetail: '迁移脚本、模型定义和 API handler 已全部更新。' },

  // ── Reviewer ──
  {
    id: 'grth1', kind: 'thinking', createdAt: T(18), author: R('reviewer'),
    content: '收到审查任务。检查清单：(1) 迁移 SQL 语法与 USING 子句 (2) ENUM 值与现有数据一致性 (3) API handler 类型守卫完整性 (4) 回滚方案。',
    isThinking: true,
  },
  { id: 'grto1', kind: 'tool_call', createdAt: T(19), author: R('reviewer'), toolName: 'Read', status: 'running' },
  { id: 'grtr1', kind: 'tool_result', createdAt: T(20), author: R('reviewer'), toolName: 'Read', status: 'completed', summary: 'migrations/003_add_status_enum.sql · 4 行' },
  { id: 'grto2', kind: 'tool_call', createdAt: T(21), author: R('reviewer'), toolName: 'Read', status: 'running' },
  { id: 'grtr2', kind: 'tool_result', createdAt: T(22), author: R('reviewer'), toolName: 'Read', status: 'completed', summary: 'src/handlers/user.ts · 92 行' },
  {
    id: 'grth2', kind: 'thinking', createdAt: T(23), author: R('reviewer'),
    content: '结论：迁移 SQL 含 USING 子句可安全回滚，ENUM 值与现有数据完全一致，handler 类型守卫无遗漏，下游 API 无破坏性变更。建议合并。',
    isThinking: false,
  },
  {
    id: 'grsub1', kind: 'subagent', createdAt: T(24), author: R('reviewer'),
    title: 'Linter 检查', worker: 'Linter', status: 'completed',
    summary: '0 errors, 0 warnings · 3 文件',
  },
  { id: 'gr1', kind: 'text', createdAt: T(25), author: R('reviewer'), text: '审查通过。ENUM 值与现有数据一致，回滚方案完善，建议合并。', displayDetail: '审查通过。ENUM 值与现有数据一致，回滚方案完善，建议合并。' },

  // ── QA ──
  {
    id: 'gqth1', kind: 'thinking', createdAt: T(26), author: Q('qa'),
    content: '总体验收清单：(1) 迁移脚本语法与回滚 (2) 模型定义完整性 (3) API handler 类型守卫 (4) 集成测试覆盖。',
    isThinking: true,
  },
  { id: 'gqto1', kind: 'tool_call', createdAt: T(27), author: Q('qa'), toolName: 'Test', status: 'running' },
  { id: 'gqtr1', kind: 'tool_result', createdAt: T(28), author: Q('qa'), toolName: 'Test', status: 'completed', summary: 'pnpm test · 12/12 passed · 2.3s' },
  { id: 'gqto2', kind: 'tool_call', createdAt: T(29), author: Q('qa'), toolName: 'Lint', status: 'running' },
  { id: 'gqtr2', kind: 'tool_result', createdAt: T(30), author: Q('qa'), toolName: 'Lint', status: 'completed', summary: 'eslint · 0 errors, 0 warnings' },
  {
    id: 'gqth2', kind: 'thinking', createdAt: T(31), author: Q('qa'),
    content: '全部通过。迁移安全，测试覆盖完整，TypeScript 编译无错误。可以合并。',
    isThinking: false,
  },
  { id: 'gq1', kind: 'text', createdAt: T(32), author: Q('qa'), text: '总体验收通过。12/12 测试通过，0 lint 错误。可以合并。', displayDetail: '总体验收通过。12/12 测试通过，0 lint 错误。可以合并。' },
  {
    id: 'gctx1', kind: 'context_usage', createdAt: T(33), author: Q('qa'),
    inputTokens: 156000, outputTokens: 4800, usagePercent: 78,
    contextLimit: 200000, modelLabel: 'Claude Sonnet 4',
  },
]
