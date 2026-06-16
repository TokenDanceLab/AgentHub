export type RowType = 'think' | 'tool' | 'file' | 'sub' | 'approval' | 'route' | 'deploy' | 'attachment' | 'ctx' | 'session'

export interface RowItem {
  id: string; type: RowType; label: string; extra?: string
  status: 'running' | 'ok' | 'fail' | 'waiting'
  collapsible: boolean; open?: boolean
  content?: string
  /** Stable tool identifier for i18n + icon routing — never translated. e.g. "read", "grep", "eslint". Also used for think variants like "analyze" and file ops like "create"/"modify"/"delete". */
  toolName?: string
  /** True if this tool card is a final result (applies result-row CSS via type check) */
  isResult?: boolean
  diffLines?: { type: 'add' | 'del' | 'ctx'; text: string }[]
  fileOp?: 'cr' | 'mod' | 'del'
  apReason?: string; standalone?: boolean
  url?: string; deployMeta?: string
  fileName?: string; fileSize?: string
  ctxPct?: number; ctxStats?: string[]
  sessionTags?: string[]
  codeLines?: string[]; codeLang?: string
  children?: RowItem[]
  orchAgents?: { id: string; agent: string; role: AgentBlock['role']; task: string; status: 'pending' | 'running' | 'ok' | 'fail'; dependsOn?: string[] }[]
  orchNote?: string
}

export interface RunGroup {
  id: string; label: string
  status: 'running' | 'done' | 'failed'
  result?: string; open: boolean
  rows: RowItem[]
}

export interface AgentBlock {
  id: string; agent: string
  role: 'builder' | 'reviewer' | 'deployer' | 'researcher' | 'orch' | 'shield'
  time: string
  rows: RowItem[]
  runs: RunGroup[]
  bubbles: string[]
  standaloneRows: RowItem[]
}

export interface Divider { type: 'divider'; time: string }
export interface UserMsg { type: 'user'; name?: string; time?: string; text: string }
export type TranscriptItem = Divider | UserMsg | AgentBlock

// ═══════════════════════════════════════════════════════════════════════
// DM — 扁平 ReAct + 子Agent 卡片栈
// ═══════════════════════════════════════════════════════════════════════

export const transcript: TranscriptItem[] = [
  { type: 'user', text: '把 users 表的 status 改成枚举' },
  {
    id: 'dm1', agent: 'Builder', role: 'builder', time: '16:09',
    bubbles: [], standaloneRows: [], runs: [],
    rows: [
      { id: 'r1a', type: 'think', label: '思考', status: 'ok', collapsible: true, content: '用户要把 status 改成枚举。先确认当前 schema 定义和现有值。' },
      { id: 'r1b', type: 'tool', label: 'Read', status: 'ok', collapsible: true, content: 'src/models/user.ts · 142 行 · 0.3s' },
      { id: 'r1c', type: 'tool', label: 'Grep', status: 'ok', collapsible: true, content: 'src/ → "status" · 12 匹配 · 5 文件' },
      { id: 'r2a', type: 'think', label: '思考', status: 'ok', collapsible: true, content: 'VARCHAR(20)，值 active/inactive/banned。创建迁移脚本 003，更新 user.ts 模型，更新 API handler。' },
      // Row header shows "创建 / 修改" + filename; code header shows type icon + language
      { id: 'r2b', type: 'file', label: '创建', extra: 'migrations/003_add_status_enum.sql', status: 'ok', collapsible: true, fileOp: 'cr',
        content: 'SQL',
        diffLines: [
          { type: 'add', text: "+ CREATE TYPE user_status AS ENUM ('active', 'inactive', 'banned');" },
          { type: 'add', text: '+ ALTER TABLE users ALTER COLUMN status TYPE user_status;' },
        ]},
      { id: 'r2c', type: 'file', label: '修改', extra: 'src/models/user.ts', status: 'ok', collapsible: true, fileOp: 'mod',
        content: 'TypeScript',
        diffLines: [
          { type: 'del', text: '-   @Column({ type: \'varchar\', length: 20 })' },
          { type: 'del', text: '-   status: string;' },
          { type: 'add', text: "+   @Column({ type: 'enum', enum: UserStatus })" },
          { type: 'add', text: '+   status: UserStatus;' },
        ]},
      { id: 'r3a', type: 'sub', label: 'Agent · Linter', status: 'ok', collapsible: true, open: false,
        children: [
          { id: 'r3b', type: 'think', label: '思考', status: 'ok', collapsible: true, content: '变更文件：migrations/003.sql, src/models/user.ts。' },
          { id: 'r3c', type: 'tool', label: 'eslint', status: 'ok', collapsible: true, content: '0 errors, 0 warnings' },
          { id: 'r3d', type: 'tool', label: 'prettier', status: 'ok', collapsible: true, content: 'All files formatted correctly' },
        ],
      },
    ],
  },
  { id: 'dm1b', agent: 'Builder', role: 'builder', time: '16:10', rows: [], runs: [],
    bubbles: ['改动完成。迁移脚本和模型定义已更新，Linter 检查通过。'], standaloneRows: [] },
  { id: 'dm2', agent: 'Builder', role: 'builder', time: '16:10', rows: [], runs: [],
    bubbles: [], standaloneRows: [
      { id: 'ap1', type: 'approval', label: '部署/写入审批', status: 'waiting', collapsible: true, standalone: true, apReason: 'Builder 请求修改 2 个文件。需要确认后继续。' },
    ]},
  { type: 'user', text: '批准，继续' },
  { id: 'dm3', agent: 'Builder', role: 'builder', time: '16:11', rows: [], runs: [],
    bubbles: ['改动完成。迁移脚本和模型定义都已更新。'], standaloneRows: [
      { id: 's1', type: 'deploy', label: '预览已就绪', status: 'ok', collapsible: true, standalone: true, url: 'https://preview.agenthub.dev/deploy-af3b21', deployMeta: '已部署 · 16:12' },
      { id: 's2', type: 'attachment', label: 'schema-diff-report.md', status: 'ok', collapsible: false, standalone: true, fileName: 'schema-diff-report.md', fileSize: '12 KB' },
      { id: 's3', type: 'tool', label: 'ToolResult', status: 'ok', collapsible: true, standalone: true, content: '3 files processed. 0 errors.' },
      { id: 's4', type: 'tool', label: 'fibonacci.ts', status: 'ok', collapsible: true, standalone: true, codeLines: ['function fib(n: number): number {', '  if (n <= 1) return n;', '  return fib(n - 1) + fib(n - 2);', '}'], codeLang: 'typescript' },
      { id: 's5', type: 'approval', label: '权限检查通过', status: 'ok', collapsible: true, standalone: true, apReason: '自动审批：变更范围仅限已有文件的格式调整。' },
      { id: 's6', type: 'ctx', label: '上下文使用', status: 'ok', collapsible: true, standalone: true, ctxPct: 42, ctxStats: ['输入 68.4k', '输出 2.1k', '上限 200k', 'Claude Sonnet 4.6'] },
    ]},
]

// ═══════════════════════════════════════════════════════════════════════
// Group
// ═══════════════════════════════════════════════════════════════════════

export const transcriptGroup: TranscriptItem[] = [
  { type: 'user', name: 'Ding', time: '16:09', text: '@Builder 把 users 表的 status 改成枚举' },
  { id: 'g1', agent: 'Builder', role: 'builder', time: '16:09', bubbles: [], standaloneRows: [], runs: [],
    rows: [
      { id: 'gr1a', type: 'think', label: '思考', status: 'ok', collapsible: true, content: '当前 status 为 VARCHAR(20)。设计 ENUM 迁移方案，需确认现有值范围。' },
      { id: 'gr1b', type: 'tool', label: 'Read', status: 'ok', collapsible: true, content: 'src/models/user.ts · 142 行 · 0.3s' },
      { id: 'gr1c', type: 'think', label: '思考', status: 'ok', collapsible: true, content: '三种值：active, inactive, banned。迁移需创建 PostgreSQL 自定义 ENUM 类型，兼容现有数据。' },
      { id: 'gr1d', type: 'tool', label: 'Grep', status: 'ok', collapsible: true, content: 'src/ → "status" · 12 匹配 · 5 文件 · 0.2s' },
      { id: 'gr1e', type: 'tool', label: 'Read', status: 'ok', collapsible: true, content: 'src/handlers/user.ts · 89 行 · 0.2s' },
      { id: 'gr1f', type: 'think', label: '思考', status: 'ok', collapsible: true, content: 'API handler 中 status 校验为字符串比较，需改为 ENUM 类型匹配。创建迁移脚本，更新模型和 handler。' },
      { id: 'gr1g', type: 'file', label: '创建', extra: 'migrations/003_add_status_enum.sql', status: 'ok', collapsible: true, fileOp: 'cr',
        content: 'SQL',
        diffLines: [
          { type: 'add', text: "+ CREATE TYPE user_status AS ENUM ('active', 'inactive', 'banned');" },
          { type: 'add', text: '+ ALTER TABLE users ALTER COLUMN status TYPE user_status USING status::user_status;' },
        ]},
      { id: 'gr1h', type: 'file', label: '修改', extra: 'src/models/user.ts', status: 'ok', collapsible: true, fileOp: 'mod',
        content: 'TypeScript',
        diffLines: [
          { type: 'del', text: '-   @Column({ type: \'varchar\', length: 20 })' },
          { type: 'del', text: '-   status: string;' },
          { type: 'add', text: "+   @Column({ type: 'enum', enum: UserStatus })" },
          { type: 'add', text: '+   status: UserStatus;' },
        ]},
    ]},
  { type: 'user', name: 'Ding', time: '16:10', text: '批准，也更新一下 API handler' },
  { id: 'g2', agent: 'Builder', role: 'builder', time: '16:10', runs: [],
    bubbles: ['API handler 已更新。'], standaloneRows: [],
    rows: [
      { id: 'gr2a', type: 'think', label: '思考', status: 'ok', collapsible: true, content: '需更新 API handler 中 status 字段的校验和类型断言，适配 ENUM 类型。' },
      { id: 'gr2b', type: 'tool', label: 'Grep', status: 'ok', collapsible: true, content: 'src/ → "status" · src/handlers/user.ts 3 处引用 · 0.2s' },
      { id: 'gr2c', type: 'think', label: '思考', status: 'ok', collapsible: true, content: 'POST /users 创建时校验字符串 → 改为 UserStatus 枚举。PATCH 同理。加入 @IsEnum 装饰器。' },
      { id: 'gr2d', type: 'tool', label: 'Read', status: 'ok', collapsible: true, content: 'src/handlers/user.ts · 89 行 · 0.2s' },
      { id: 'gr2e', type: 'file', label: '修改', extra: 'src/handlers/user.ts', status: 'ok', collapsible: true, fileOp: 'mod',
        content: 'TypeScript',
        diffLines: [
          { type: 'del', text: '-   @IsString()' },
          { type: 'del', text: '-   @IsIn([\'active\', \'inactive\', \'banned\'])' },
          { type: 'del', text: '-   status: string;' },
          { type: 'add', text: '+   @IsEnum(UserStatus)' },
          { type: 'add', text: '+   status: UserStatus;' },
        ]},
    ]},
  { id: 'g3', agent: 'Orchestrator', role: 'orch', time: '16:11', runs: [],
    bubbles: [], standaloneRows: [],
    rows: [
      { id: 'go1', type: 'think', label: '思考', status: 'ok', collapsible: true, content: '用户 @Ding 要求把 status 改成 ENUM。先了解项目结构，确认改动范围。' },
      { id: 'go2', type: 'tool', label: 'Read', status: 'ok', collapsible: true, content: 'src/models/user.ts · 142 行 · status 字段当前为 VARCHAR(20)' },
      { id: 'go3', type: 'tool', label: 'Grep', status: 'ok', collapsible: true, content: 'src/ → "status" · 12 匹配 · 5 文件' },
      { id: 'go4', type: 'think', label: '思考完成', status: 'ok', collapsible: true, content: '改动涉及 3 处：model 定义、handler 校验、迁移脚本。拆 3 个子任务：Builder 负责实现、Reviewer 负责审查、QA 总体验收。Builder 与 Reviewer 可并行。' },
      { id: 'go5', type: 'route', label: '拆解完成 · A∥B → C', status: 'ok', collapsible: false, standalone: true,
        content: '两阶段流水线：Builder + Reviewer 并行执行 → QA 总体验收。',
        orchAgents: [
          { id: 'ob', agent: 'Builder', role: 'builder', task: 'ENUM 迁移 + Model + API', status: 'running', dependsOn: [] },
          { id: 'or', agent: 'Reviewer', role: 'reviewer', task: '安全审查 + 合规检查', status: 'running', dependsOn: [] },
          { id: 'oq', agent: 'QA', role: 'deployer', task: '总体验收 + 集成测试', status: 'pending', dependsOn: ['ob', 'or'] },
        ],
        orchNote: 'Builder 和 Reviewer 并行完成 → QA 正在总体验收中...' },
    ]},
  { type: 'user', name: 'Ding', time: '16:11', text: '全部批准，让 Reviewer 检查' },
  { id: 'g4', agent: 'Reviewer', role: 'reviewer', time: '16:12', runs: [],
    bubbles: ['审查通过。建议合并。'], standaloneRows: [],
    rows: [
      { id: 'gr4a', type: 'think', label: '思考', status: 'ok', collapsible: true, content: '变更范围：迁移脚本 + 模型 + handler。先 Code Review 再派 Linter 子 Agent 检查。' },
      { id: 'gr4b', type: 'tool', label: 'Read', status: 'ok', collapsible: true, content: 'migrations/003_add_status_enum.sql · 4 行 · 0.1s' },
      { id: 'gr4c', type: 'tool', label: 'Read', status: 'ok', collapsible: true, content: 'src/handlers/user.ts · 89 行 · 0.2s' },
      { id: 'gr4d', type: 'think', label: '思考', status: 'ok', collapsible: true, content: '迁移 SQL 含 USING 子句可回滚，handler 校验改为 @IsEnum 无遗漏。' },
      { id: 'gr4e', type: 'file', label: '修改', extra: 'src/models/user.ts', status: 'ok', collapsible: true, fileOp: 'mod',
        content: 'TypeScript',
        diffLines: [
          { type: 'del', text: '-   status: string;' },
          { type: 'add', text: '+   status: UserStatus;' },
        ]},
      { id: 'gr4f', type: 'think', label: '思考', status: 'ok', collapsible: true, content: 'ENUM 值与现有数据一致，回滚路径完善，下游 API 响应无破坏性变更。' },
      { id: 'gr4g', type: 'sub', label: 'Agent · Linter', status: 'ok', collapsible: true, open: false,
        children: [
          { id: 'gr4h', type: 'think', label: '思考', status: 'ok', collapsible: true, content: '检查变更文件：migrations/003.sql, src/models/user.ts, src/handlers/user.ts。' },
          { id: 'gr4i', type: 'tool', label: 'eslint', status: 'ok', collapsible: true, content: '0 errors, 0 warnings · 3 files' },
          { id: 'gr4j', type: 'tool', label: 'prettier', status: 'ok', collapsible: true, content: 'All files formatted correctly' },
          { id: 'gr4k', type: 'tool', label: 'tsc --noEmit', status: 'ok', collapsible: true, content: 'TypeScript compilation passed · 0 errors' },
        ],
      },
    ]},
  { id: 'g5', agent: 'Builder', role: 'builder', time: '16:13', rows: [], runs: [],
    bubbles: ['所有卡片类型展示：'], standaloneRows: [
      { id: 'ss1', type: 'deploy', label: '预览已就绪', status: 'ok', collapsible: true, standalone: true, url: 'https://preview.agenthub.dev/deploy-af3b21', deployMeta: '已部署 · 16:12' },
      { id: 'ss2', type: 'attachment', label: 'schema-diff-report.md', status: 'ok', collapsible: false, standalone: true, fileName: 'schema-diff-report.md', fileSize: '12 KB' },
      { id: 'ss3', type: 'tool', label: 'UserStatus.ts', status: 'ok', collapsible: true, standalone: true, codeLines: ['export enum UserStatus {', '  ACTIVE = \'active\',', '  INACTIVE = \'inactive\',', '  BANNED = \'banned\',', '}'], codeLang: 'typescript' },
      { id: 'ss4', type: 'session', label: 'Builder · status 枚举迁移', status: 'ok', collapsible: true, standalone: true, sessionTags: ['Runtime: Claude Code', 'Target: local'] },
    ]},
]
