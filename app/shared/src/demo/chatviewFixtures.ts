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
  { id: 'bu1', kind: 'text', createdAt: T(0), author: U('ding'), text: 'Change the status column in users table to ENUM type using PostgreSQL native enum' },
  { id: 'ba1', kind: 'text', createdAt: T(1), author: B('builder'), text: 'Got it. Confirming current schema and all reference points first, then producing a migration plan.', displayTitle: 'Task acknowledgment', displayDetail: 'Confirming current schema and all reference points first, then producing a migration plan.' },
  {
    id: 'bth1', kind: 'thinking', createdAt: T(2), author: B('builder'),
    content: 'User wants to change status to an enum. Currently status is VARCHAR(20) with values active/inactive/banned. Need to create a PostgreSQL custom ENUM type, compatible with existing data. Files involved: model definition, API handler validation, migration script.',
    isThinking: true,
  },
  { id: 'bto1', kind: 'tool_call', createdAt: T(3), author: B('builder'), toolName: 'Read', status: 'running' },
  { id: 'btr1', kind: 'tool_result', createdAt: T(4), author: B('builder'), toolName: 'Read', status: 'completed', summary: 'src/models/user.ts · 142 lines · status field currently VARCHAR(20)' },
  { id: 'bto2', kind: 'tool_call', createdAt: T(5), author: B('builder'), toolName: 'Grep', status: 'running' },
  { id: 'btr2', kind: 'tool_result', createdAt: T(6), author: B('builder'), toolName: 'Grep', status: 'completed', summary: 'src/ → "status" · 12 matches · 5 files · model + handler + 3 business references' },
  {
    id: 'bth2', kind: 'thinking', createdAt: T(7), author: B('builder'),
    content: 'VARCHAR(20), values active/inactive/banned. Create migration script 003, update user.ts model, update API handler type guard. Three files, scope is manageable.',
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
    summary: '0 errors, 0 warnings · eslint + prettier + tsc all passed',
  },
  {
    id: 'bsub2', kind: 'subagent', createdAt: T(12), author: B('builder'),
    title: '安全检查', worker: 'SecurityAuditor', status: 'completed',
    summary: 'Audit complete: 0 vulnerabilities, 0 risk items. ENUM migration is safe, permission model unchanged.',
  },
  {
    id: 'bsub3', kind: 'subagent', createdAt: T(13), author: B('builder'),
    title: '文档生成', worker: 'DocGenerator', status: 'completed',
    summary: 'CHANGELOG.md updated · API docs synced',
  },
  { id: 'ba2', kind: 'text', createdAt: T(14), author: B('builder'), text: 'Changes ready. Migration script and model definition updated, linter and security audit both passed. Approval required to proceed.', displayTitle: 'Changes ready', displayDetail: 'Migration script and model definition updated, linter and security audit both passed.' },
  {
    id: 'bap1', kind: 'approval', createdAt: T(15), author: B('builder'),
    title: '部署/写入审批', status: 'pending',
    reason: 'Builder requests modification of 3 files. Confirmation required to proceed.',
  },
  { id: 'bu2', kind: 'text', createdAt: T(16), author: U('ding'), text: 'Approved, proceed' },
  { id: 'ba3', kind: 'text', createdAt: T(17), author: B('builder'), text: 'Approval granted. Deploying preview.' },
  {
    id: 'bdep1', kind: 'deploy', createdAt: T(18), author: B('builder'),
    runId: 'run_builder_001', status: 'deployed', url: 'https://preview.example.com/deploy-af3b21',
  },
  {
    id: 'bctx1', kind: 'context_usage', createdAt: T(19), author: B('builder'),
    inputTokens: 68400, outputTokens: 2100, usagePercent: 42,
    contextLimit: 200000, modelLabel: 'Claude Sonnet 4',
  },
  { id: 'ba4', kind: 'text', createdAt: T(20), author: B('builder'), text: 'All done. Migration script + model + handler updated, 12/12 tests passing.' },
]

// ═══════════════════════════════════════════════════════════════════════
// Agent Collab Group — multi-agent: Builder → Orchestrator → Reviewer → QA
// ═══════════════════════════════════════════════════════════════════════

const O = (id: string) => ({ id, name: 'Orchestrator', role: 'agent' as const })
const R = (id: string) => ({ id, name: 'Reviewer', role: 'agent' as const })
const Q = (id: string) => ({ id, name: 'QA', role: 'agent' as const })

export const chatviewAgentCollabTranscript: TranscriptBlock[] = [
  { id: 'gu1', kind: 'text', createdAt: T(0), author: U('ding'), text: '@Orchestrator Change the status column in users table to ENUM type, coordinate this' },

  // ── Orchestrator ReAct ──
  {
    id: 'goth1', kind: 'thinking', createdAt: T(1), author: O('orch'),
    content: '@Ding asked to change the users table status from VARCHAR to ENUM. First, understand the project structure, locate relevant files, confirm the scope of changes.',
    isThinking: true,
  },
  { id: 'goto1', kind: 'tool_call', createdAt: T(2), author: O('orch'), toolName: 'Read', status: 'running' },
  { id: 'gotr1', kind: 'tool_result', createdAt: T(3), author: O('orch'), toolName: 'Read', status: 'completed', summary: 'src/models/user.ts · 142 lines · status field currently VARCHAR(20)' },
  { id: 'goto2', kind: 'tool_call', createdAt: T(4), author: O('orch'), toolName: 'Grep', status: 'running' },
  { id: 'gotr2', kind: 'tool_result', createdAt: T(5), author: O('orch'), toolName: 'Grep', status: 'completed', summary: 'src/ → "status" · 12 matches · 5 files · model + handler + 3 references' },
  {
    id: 'goth2', kind: 'thinking', createdAt: T(6), author: O('orch'),
    content: 'Changes span 3 locations: model definition @Column, handler validation @IsEnum, new migration script needed. Split into 3 subtasks: Builder handles implementation, Reviewer handles review, QA handles final acceptance. Builder and Reviewer can run in parallel.',
    isThinking: false,
  },
  {
    id: 'gort1', kind: 'route_decision', createdAt: T(7), author: O('orch'),
    action: 'Decomposed · parallel + sequential', summary: 'Two phases: Builder + Reviewer parallel for implementation and review → QA sequential for final acceptance.',
    targetAgent: 'Builder, Reviewer → QA',
  },
  { id: 'go1', kind: 'text', createdAt: T(8), author: O('orch'), text: 'Analysis complete. Decomposed into 2 phases: Builder + Reviewer parallel → QA final acceptance.', displayDetail: 'Decomposed into 2 phases: Builder + Reviewer parallel → QA final acceptance.' },

  // ── Builder ──
  {
    id: 'gbth1', kind: 'thinking', createdAt: T(9), author: B('builder2'),
    content: 'VARCHAR(20), existing values active/inactive/banned. Create migration script, update model definition, update API handler type guard.',
    isThinking: true,
  },
  { id: 'gbto1', kind: 'tool_call', createdAt: T(10), author: B('builder2'), toolName: 'Read', status: 'running' },
  { id: 'gbtr1', kind: 'tool_result', createdAt: T(11), author: B('builder2'), toolName: 'Read', status: 'completed', summary: 'src/models/user.ts · 142 lines' },
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
