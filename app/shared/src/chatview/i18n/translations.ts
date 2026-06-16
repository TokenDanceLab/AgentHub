/* ═══════════════════════════════════════════════════════════════════════
   I18N — typed translations dictionary
   Keys: dot-separated paths. Add new keys here; TypeScript enforces usage.
   ══════════════════════════════════════════════════════════════════════ */

export const translations = {
  'en-US': {
    // App shell
    'app.dm.title': 'DM Mode',
    'app.dm.desc': '1-on-1 chat · avatar only · all card types',
    'app.dm.sim': 'Live Simulation · DM',
    'app.dm.simDesc': 'Dynamic demo: thinking → tool calls → file changes → agent reply',
    'app.group.title': 'Group Mode',
    'app.group.desc': 'Multi-agent · avatar+name+time · full cards + dispatch/approval',
    'app.group.sim': 'Live Simulation · Group',
    'app.group.simDesc': '@Orchestrator dispatch → Builder execute → Reviewer audit',
    'app.lang': 'Language',
    'app.theme': 'Theme',

    // Chat
    'chat.you': 'You',

    // Card labels — status-aware (running vs done)
    'card.think.running': 'Thinking...',
    'card.think.done': 'Thinking done',
    'card.think.analyze': 'Analyzing',
    'card.think.analyzeDone': 'Analysis done',
    'card.tool.read': 'Read',
    'card.tool.read.running': 'Reading...',
    'card.tool.grep': 'Grep',
    'card.tool.grep.running': 'Searching...',
    'card.tool.write': 'Write',
    'card.tool.write.running': 'Writing...',
    'card.tool.result': 'ToolResult',
    'card.tool.eslint': 'eslint',
    'card.tool.prettier': 'prettier',
    'card.tool.tsc': 'tsc --noEmit',
    'card.tool.audit': 'Audit',
    'card.tool.audit.running': 'Auditing...',
    'card.tool.check': 'Check',
    'card.tool.test': 'Test',
    'card.tool.test.running': 'Testing...',
    'card.tool.lint': 'Lint',
    'card.tool.lint.running': 'Linting...',
    'card.file.create': 'Create',
    'card.file.create.running': 'Creating...',
    'card.file.modify': 'Modify',
    'card.file.modify.running': 'Modifying...',
    'card.file.delete': 'Delete',
    'card.file.delete.running': 'Deleting...',
    'card.sub.agent': 'Agent',
    'card.sub.agent.withName': 'Agent · {name}',
    'card.sub.agent.running': 'Agent · {name} working...',
    'card.approval.title': 'Deploy/Write Approval',
    'card.approval.waiting': 'Awaiting approval...',
    'card.approval.ok': 'Permission check passed',
    'card.approval.fail': 'Approval denied',
    'card.approval.approve': 'Approve',
    'card.approval.deny': 'Deny',
    'card.deploy.ready': 'Preview Ready',
    'card.route.dag': 'Dispatch · parallel → serial',
    'card.session.prefix': 'Session',
    'card.fail.retry': 'Retry',

    // Sidebar
    'sidebar.overview': 'Overview',
    'sidebar.files': 'Files',
    'sidebar.context': 'Context',
    'sidebar.tasks': 'Tasks',
    'sidebar.modelName': 'Claude Sonnet 4.6',
    'sidebar.contextUse': 'Context Usage',
    'sidebar.allFiles': 'All files',
    'sidebar.contextDetail': 'Context details',
    'sidebar.input': 'Input',
    'sidebar.output': 'Output',
    'sidebar.limit': 'Limit',
    'sidebar.cache': 'Cache',
    'sidebar.cost': 'Cost',
    'sidebar.done': 'All done',

    // Code
    'code.copy': 'Copy',

    // Transcript
    'transcript.empty': 'No messages yet',

    // Simulation
    'sim.next': 'Next',
    'sim.skip': 'Skip',
    'sim.auto': '▶ Auto',
    'sim.stop': '⏸ Stop',
    'sim.reset': 'Reset',
    'sim.start': 'Click to start',
    'sim.step': 'Step',

    // Mock data — user messages
    'mock.dm.user1': 'Change the status column in users table to enum',
    'mock.dm.user2': 'Approve, continue',
    'mock.dm.user3': 'Call two agents to check security and generate docs',
    'mock.group.user1': '@Builder change users table status to enum',
    'mock.group.user2': 'Approve, also update the API handler',
    'mock.group.user3': 'Approve all, let Reviewer check',

    // Mock data — agent think
    'mock.dm.think1': 'The user wants to change status to enum. First check the current schema definition and existing values.',
    'mock.dm.think2': 'VARCHAR(20), values active/inactive/banned. Create migration 003, update user.ts model, update API handler type guards.',
    'mock.group.think1': 'Current status is VARCHAR(20). Design ENUM migration, need to confirm existing value range.',
    'mock.group.think2': 'Three values: active, inactive, banned. Migration needs PostgreSQL custom ENUM type, compatible with existing data.',
    'mock.group.think3': 'API handler status validation uses string comparison, needs ENUM type matching. Create migration, update model and handler.',
    'mock.group.think4': 'Need to update API handler status field validation and type assertion for ENUM type.',
    'mock.group.think5': 'POST /users creation validation string→UserStatus enum. PATCH same. Add @IsEnum decorator.',
    'mock.group.think6': 'Change scope: migration + model + handler. Code review first, then dispatch Linter sub-agent.',
    'mock.group.think7': 'Migration SQL has USING clause, rollback-ready. Handler validation changed to @IsEnum, no gaps.',
    'mock.group.think8': 'ENUM values match existing data, rollback path complete, downstream API responses unchanged.',
    'mock.group.qa.think1': 'Acceptance checklist: (1) Migration syntax (2) Model definition (3) API handler type guard (4) Integration tests.',
    'mock.group.qa.think2': 'All checks passed. Migration safe, test coverage complete, docs updated. Ready to merge.',
    'mock.sub.security': 'Received security audit task. Need to audit: (1) SQL injection risk (2) Permission model changes (3) Data integrity constraints.',
    'mock.sub.securityDone': 'Conclusion: 0 vulnerabilities, 0 risk items. ENUM migration safe. Permission model unchanged. Data integrity preserved.',
    'mock.sub.doc': 'Generate docs for current changes. Scope: new ENUM migration + model definition + API handler update.',
    'mock.sub.docDone': 'Docs generated. CHANGELOG and API docs cover all changes.',

    // Mock data — tool results
    'mock.tool.readModel': 'src/models/user.ts · 142 lines · 0.3s',
    'mock.tool.grepStatus': 'src/ → "status" · 12 matches · 5 files · 0.2s',
    'mock.tool.grepHandler': 'src/ → "status" · src/handlers/user.ts 3 refs · 0.2s',
    'mock.tool.readHandler': 'src/handlers/user.ts · 89 lines · 0.2s',
    'mock.tool.readMigration': 'migrations/003_add_status_enum.sql · 4 lines · 0.1s',
    'mock.tool.scan': 'Scan migrations/003.sql + src/models/user.ts',
    'mock.tool.checkEnum': 'ENUM values active/inactive/banned match existing data',
    'mock.tool.readDocs': 'migrations/003.sql · src/models/user.ts · src/api/users.ts',
    'mock.tool.writeChangelog': 'CHANGELOG.md · added v0.5.0 entry',
    'mock.tool.testResult': 'pnpm test · 12/12 passed · 2.3s',
    'mock.tool.lintResult': 'eslint · 0 errors, 0 warnings',
    'mock.tool.lintResultFiles': 'eslint · 0 errors, 0 warnings · 3 files',
    'mock.tool.tscResult': 'TypeScript compilation passed · 0 errors',
    'mock.tool.prettierResult': 'All files formatted correctly',
    'mock.tool.result3Files': '3 files processed. 0 errors.',

    // Mock data — bubbles
    'mock.bubble.dmDone': 'Done. Migration script and model definition updated, Linter check passed.',
    'mock.bubble.dmTwoDone': 'Two agents completed. Security check passed, docs generated.',
    'mock.bubble.groupPlan': 'Analysis complete. Split into 2 phases: Builder + Reviewer parallel → QA acceptance.',
    'mock.bubble.groupDone': 'Migration script and model updated.',
    'mock.bubble.groupApiDone': 'API handler updated.',
    'mock.bubble.groupReviewDone': 'Review passed. ENUM values consistent, rollback ready. Recommend merge.',
    'mock.bubble.groupAllDone': 'All done.',
    'mock.bubble.groupQADone': 'Acceptance passed. 12/12 tests passing. Ready to merge.',

    // Mock data — file content
    'mock.file.migrationName': 'migrations/003_add_status_enum.sql',
    'mock.file.modelName': 'src/models/user.ts',
    'mock.file.handlerName': 'src/handlers/user.ts',
    'mock.file.changelogName': 'CHANGELOG.md',
    'mock.file.contentSQL': 'SQL',
    'mock.file.contentTS': 'TypeScript',
    'mock.file.contentMD': 'Markdown',

    // Mock data — orch
    'mock.orch.taskBuilder': 'ENUM migration + Model + API',
    'mock.orch.taskReviewer': 'Security review + compliance check',
    'mock.orch.taskQA': 'Acceptance + integration test',
    'mock.orch.content': 'Two-phase pipeline: Builder + Reviewer parallel → QA acceptance.',
    'mock.orch.note': 'Builder and Reviewer in parallel → QA waiting for both to complete.',
    'mock.orch.noteRunning': 'Builder and Reviewer complete → QA running acceptance...',
    'mock.orch.label': 'Dispatch complete · Parallel + Serial',

    // Mock data — session / deploy / attachment
    'mock.session.builder': 'Builder · status enum migration',
    'mock.session.runtime': 'Runtime: Claude Code',
    'mock.session.target': 'Target: local',
    'mock.deploy.url': 'https://preview.agenthub.dev/deploy-af3b21',
    'mock.deploy.meta': 'Deployed · 16:12',
    'mock.attachment.report': 'schema-diff-report.md',

    // Mock data — approval
    'mock.approval.autoCheck': 'Auto-approval: changes limited to existing file formatting.',

    // Mock data — sub-agent names
    'mock.sub.linter': 'Linter',
    'mock.sub.securityAuditor': 'SecurityAuditor',
    'mock.sub.docGenerator': 'DocGenerator',

    // Mock data — code
    'mock.code.userStatus': 'export enum UserStatus {',
    'mock.code.active': "  ACTIVE = 'active',",
    'mock.code.inactive': "  INACTIVE = 'inactive',",
    'mock.code.banned': "  BANNED = 'banned',",
    'mock.code.closeBrace': '}',

    // Mock data — sim think texts
    'mock.sim.think1': 'The user wants to change status to enum. First check the current table structure, see the status column type and existing values.',
    'mock.sim.think2': 'VARCHAR(20), values active/inactive/banned. Create ENUM migration 003, update user.ts model, update API handler type guards. Three files, scope is manageable.',
    'mock.sim.groupThink': 'Received status enum migration task dispatched by @Orchestrator.',
    'mock.sim.user1': 'Change users table status to enum',
    'mock.sim.user2': 'Call two agents to check security and generate docs',
    'mock.sim.groupUser': '@Orchestrator dispatch: Builder change status enum, Reviewer audit, QA accept',
    'mock.sim.sub.think1': 'Received security audit task. Need to audit: (1) SQL injection risk (2) Permission model changes (3) Data integrity constraints.',
    'mock.sim.sub.think2': 'Conclusion: 0 vulnerabilities, 0 risk items. ENUM migration safe. Permission model unchanged. Data integrity preserved.',
    'mock.sim.sub.doc1': 'Generate docs based on current changes. Scope: new ENUM migration + model definition + API handler update.',

    // Mock data — review think
    'mock.review.think1': 'Received review task. Check: (1) Migration SQL syntax (2) ENUM values vs existing data (3) Rollback plan.',
    'mock.review.think2': 'Conclusion: ENUM values fully consistent with existing data, rollback plan complete (DROP TYPE), no breaking changes to downstream API.',
  },

  'zh-CN': {
    // App shell
    'app.dm.title': '单聊模式',
    'app.dm.desc': '你 ↔ Builder · 仅头像 · 所有卡片类型',
    'app.dm.sim': '实时模拟 · 单聊',
    'app.dm.simDesc': '动态演示：思考中 → 工具调用 → 文件变更 → Agent 回复',
    'app.group.title': '群聊模式',
    'app.group.desc': '多人协作 · 头像+名字+时间 · 完整卡片类型 + 分派/审批',
    'app.group.sim': '实时模拟 · 群聊',
    'app.group.simDesc': '@Orchestrator 分派 → Builder 执行 → Reviewer 审查',
    'app.lang': '语言',
    'app.theme': '主题',

    // Chat
    'chat.you': '你',

    // Card labels — status-aware (running vs done)
    'card.think.running': '正在思考',
    'card.think.done': '思考完成',
    'card.think.analyze': '分析',
    'card.think.analyzeDone': '分析完成',
    'card.tool.read': 'Read',
    'card.tool.read.running': '正在阅读',
    'card.tool.grep': 'Grep',
    'card.tool.grep.running': '正在搜索',
    'card.tool.write': 'Write',
    'card.tool.write.running': '正在写入',
    'card.tool.result': '工具结果',
    'card.tool.eslint': 'eslint',
    'card.tool.prettier': 'prettier',
    'card.tool.tsc': 'tsc --noEmit',
    'card.tool.audit': 'Audit',
    'card.tool.audit.running': '正在审计',
    'card.tool.check': 'Check',
    'card.tool.test': 'Test',
    'card.tool.test.running': '正在测试',
    'card.tool.lint': 'Lint',
    'card.tool.lint.running': '正在检查',
    'card.file.create': '创建',
    'card.file.create.running': '正在创建',
    'card.file.modify': '修改',
    'card.file.modify.running': '正在修改',
    'card.file.delete': '删除',
    'card.file.delete.running': '正在删除',
    'card.sub.agent': 'Agent',
    'card.sub.agent.withName': 'Agent · {name}',
    'card.sub.agent.running': 'Agent · {name} 工作中',
    'card.approval.title': '部署/写入审批',
    'card.approval.waiting': '等待审批中...',
    'card.approval.ok': '权限检查通过',
    'card.approval.fail': '审批被拒绝',
    'card.approval.approve': '批准',
    'card.approval.deny': '拒绝',
    'card.deploy.ready': '预览已就绪',
    'card.route.dag': '拆解完成 · 并行 + 串行',
    'card.session.prefix': '',
    'card.fail.retry': '重试',

    // Sidebar
    'sidebar.overview': '概览',
    'sidebar.files': '文件',
    'sidebar.context': '上下文',
    'sidebar.tasks': '任务',
    'sidebar.modelName': 'Claude Sonnet 4.6',
    'sidebar.contextUse': '上下文使用',
    'sidebar.allFiles': '所有文件',
    'sidebar.contextDetail': '上下文详情',
    'sidebar.input': '输入',
    'sidebar.output': '输出',
    'sidebar.limit': '上限',
    'sidebar.cache': '缓存',
    'sidebar.cost': '费用',
    'sidebar.done': '全部完成',

    // Code
    'code.copy': '复制',

    // Transcript
    'transcript.empty': '暂无消息',

    // Simulation
    'sim.next': '下一步',
    'sim.skip': '跳过',
    'sim.auto': '▶ 自动',
    'sim.stop': '⏸ 停止',
    'sim.reset': '重置',
    'sim.start': '点击开始',
    'sim.step': '步骤',

    // Mock data — user messages
    'mock.dm.user1': '把 users 表的 status 改成枚举',
    'mock.dm.user2': '批准，继续',
    'mock.dm.user3': '请调用两个 Agent 分别检查安全性和生成文档',
    'mock.group.user1': '@Builder 把 users 表的 status 改成枚举',
    'mock.group.user2': '批准，也更新一下 API handler',
    'mock.group.user3': '全部批准，让 Reviewer 检查',

    // Mock data — agent think
    'mock.dm.think1': '用户要把 status 改成枚举。先确认当前 schema 定义和现有值。',
    'mock.dm.think2': 'VARCHAR(20)，值 active/inactive/banned。创建迁移脚本 003，更新 user.ts 模型，更新 API handler。',
    'mock.group.think1': '当前 status 为 VARCHAR(20)。设计 ENUM 迁移方案，需确认现有值范围。',
    'mock.group.think2': '三种值：active, inactive, banned。迁移需创建 PostgreSQL 自定义 ENUM 类型，兼容现有数据。',
    'mock.group.think3': 'API handler 中 status 校验为字符串比较，需改为 ENUM 类型匹配。创建迁移脚本，更新模型和 handler。',
    'mock.group.think4': '需更新 API handler 中 status 字段的校验和类型断言，适配 ENUM 类型。',
    'mock.group.think5': 'POST /users 创建时校验字符串 → 改为 UserStatus 枚举。PATCH 同理。加入 @IsEnum 装饰器。',
    'mock.group.think6': '变更范围：迁移脚本 + 模型 + handler。先 Code Review 再派 Linter 子 Agent 检查。',
    'mock.group.think7': '迁移 SQL 含 USING 子句可回滚，handler 校验改为 @IsEnum 无遗漏。',
    'mock.group.think8': 'ENUM 值与现有数据一致，回滚路径完善，下游 API 响应无破坏性变更。',
    'mock.group.qa.think1': '总体验收清单：(1) 迁移脚本语法检查 (2) 模型定义完整性 (3) API handler 类型守卫 (4) 集成测试。',
    'mock.group.qa.think2': '全部检查通过。迁移安全，测试覆盖完整，文档已更新。可以合并。',
    'mock.sub.security': '收到安全检查任务。需要审计：(1) SQL 注入风险 (2) 权限模型变更 (3) 数据完整性约束。',
    'mock.sub.securityDone': '结论：0 漏洞，0 风险项。ENUM 迁移安全。权限模型未变更。数据完整性保持。',
    'mock.sub.doc': '根据本次变更生成文档。变更范围：新增 ENUM 迁移 + 模型定义修改 + API handler 更新。',
    'mock.sub.docDone': '文档已生成。CHANGELOG 和 API 文档覆盖全部变更。',

    // Mock data — tool results
    'mock.tool.readModel': 'src/models/user.ts · 142 行 · 0.3s',
    'mock.tool.grepStatus': 'src/ → "status" · 12 匹配 · 5 文件 · 0.2s',
    'mock.tool.grepHandler': 'src/ → "status" · src/handlers/user.ts 3 处引用 · 0.2s',
    'mock.tool.readHandler': 'src/handlers/user.ts · 89 行 · 0.2s',
    'mock.tool.readMigration': 'migrations/003_add_status_enum.sql · 4 行 · 0.1s',
    'mock.tool.scan': '扫描 migrations/003.sql + src/models/user.ts',
    'mock.tool.checkEnum': 'ENUM 值 active/inactive/banned 与现有数据一致',
    'mock.tool.readDocs': 'migrations/003.sql · src/models/user.ts · src/api/users.ts',
    'mock.tool.writeChangelog': 'CHANGELOG.md · 新增 v0.5.0 条目',
    'mock.tool.testResult': 'pnpm test · 12/12 passed · 2.3s',
    'mock.tool.lintResult': 'eslint · 0 errors, 0 warnings',
    'mock.tool.lintResultFiles': 'eslint · 0 errors, 0 warnings · 3 文件',
    'mock.tool.tscResult': 'TypeScript compilation passed · 0 errors',
    'mock.tool.prettierResult': 'All files formatted correctly',
    'mock.tool.result3Files': '3 files processed. 0 errors.',

    // Mock data — bubbles
    'mock.bubble.dmDone': '改动完成。迁移脚本和模型定义已更新，Linter 检查通过。',
    'mock.bubble.dmTwoDone': '两个 Agent 已完成。安全性检查通过，文档已生成。',
    'mock.bubble.groupPlan': '分析完成。拆解为 2 阶段：Builder + Reviewer 并行 → QA 总体验收。',
    'mock.bubble.groupDone': '迁移脚本和模型已更新。',
    'mock.bubble.groupApiDone': 'API handler 已更新。',
    'mock.bubble.groupReviewDone': '审查通过。ENUM 值与现有数据一致，回滚方案完善，建议合并。',
    'mock.bubble.groupAllDone': '全部完成。',
    'mock.bubble.groupQADone': '总体验收通过。12/12 测试通过，可以合并。',

    // Mock data — file content
    'mock.file.migrationName': 'migrations/003_add_status_enum.sql',
    'mock.file.modelName': 'src/models/user.ts',
    'mock.file.handlerName': 'src/handlers/user.ts',
    'mock.file.changelogName': 'CHANGELOG.md',
    'mock.file.contentSQL': 'SQL',
    'mock.file.contentTS': 'TypeScript',
    'mock.file.contentMD': 'Markdown',

    // Mock data — orch
    'mock.orch.taskBuilder': 'ENUM 迁移 + Model + API',
    'mock.orch.taskReviewer': '安全审查 + 合规检查',
    'mock.orch.taskQA': '总体验收 + 集成测试',
    'mock.orch.content': '两阶段流水线：Builder + Reviewer 并行 → QA 总体验收。',
    'mock.orch.note': 'Builder 和 Reviewer 并行完成 → QA 正在总体验收中...',
    'mock.orch.noteRunning': 'Builder 和 Reviewer 并行完成 → QA 正在总体验收中...',
    'mock.orch.label': '拆解完成 · 并行 + 串行',

    // Mock data — session / deploy / attachment
    'mock.session.builder': 'Builder · status 枚举迁移',
    'mock.session.runtime': 'Runtime: Claude Code',
    'mock.session.target': 'Target: local',
    'mock.deploy.url': 'https://preview.agenthub.dev/deploy-af3b21',
    'mock.deploy.meta': '已部署 · 16:12',
    'mock.attachment.report': 'schema-diff-report.md',

    // Mock data — approval
    'mock.approval.autoCheck': '自动审批：变更范围仅限已有文件的格式调整。',

    // Mock data — sub-agent names
    'mock.sub.linter': 'Linter',
    'mock.sub.securityAuditor': 'SecurityAuditor',
    'mock.sub.docGenerator': 'DocGenerator',

    // Mock data — code
    'mock.code.userStatus': 'export enum UserStatus {',
    'mock.code.active': "  ACTIVE = 'active',",
    'mock.code.inactive': "  INACTIVE = 'inactive',",
    'mock.code.banned': "  BANNED = 'banned',",
    'mock.code.closeBrace': '}',

    // Mock data — sim think texts
    'mock.sim.think1': '用户要把 status 改成枚举。先确认当前表结构，看看 status 列的类型和现有值。',
    'mock.sim.think2': 'VARCHAR(20)，值 active/inactive/banned。创建 ENUM 迁移脚本 003，更新 user.ts 模型，更新 API handler 类型守卫。三个文件改动范围可控。',
    'mock.sim.groupThink': '收到 @Orchestrator 分派的 status 枚举迁移任务。',
    'mock.sim.user1': '把 users 表的 status 改成枚举',
    'mock.sim.user2': '请调用两个 Agent 分别检查安全性和生成文档',
    'mock.sim.groupUser': '@Orchestrator 分配任务：Builder 改 status 枚举，Reviewer 审查，QA 验收',
    'mock.sim.sub.think1': '收到安全检查任务。需要审计：(1) SQL 注入风险 (2) 权限模型变更 (3) 数据完整性约束。',
    'mock.sim.sub.think2': '结论：0 漏洞，0 风险项。ENUM 迁移安全。权限模型未变更。数据完整性保持。',
    'mock.sim.sub.doc1': '根据本次变更生成文档。变更范围：新增 ENUM 迁移 + 模型定义修改 + API handler 更新。',

    // Mock data — review think
    'mock.review.think1': '收到审查任务。检查：(1) 迁移 SQL 语法 (2) ENUM 值与现有数据一致性 (3) 回滚方案。',
    'mock.review.think2': '结论：ENUM 值与现有数据完全一致，回滚方案完善（可 DROP TYPE），下游 API 无破坏性变更。',
  },
} as const

export type Locale = keyof typeof translations
export type TransKey = keyof typeof translations['en-US']

export const locales: { code: Locale; label: string }[] = [
  { code: 'zh-CN', label: '中文' },
  { code: 'en-US', label: 'English' },
]
