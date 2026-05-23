# AgentHub 路线图 — P0 集成冲刺 → P1 交互体验

最后更新：2026-05-23

## 当前总目标

**P0 已全部完成。P1 聚焦交互体验：** 在 P0 完整事件管道基础上，将 UI 从"能用"提升到"同类产品水平"——Markdown 渲染、代码语法高亮、多行输入、Stop 按钮、Diff 交互。

## 工作区

```
dev/delicious233          ← 主 dev（Leader）: ROADMAP + 架构决策
feat/trump-webui          ← Web 前端（Trump）
```

合并方向：`feat/* → dev/delicious233 → master`

## P0 冲刺任务 ✅ (全部完成 27/27)

### Edge（Leader + Agent）
- [x] Claude Code NDJSON 24 消息类型
- [x] stdin 控制协议 + cancel
- [x] OpenCode --format json 解析
- [x] 模型选择 + 推理强度 + alias
- [x] Codex 全事件覆盖（thread/turn/item 9种类型）
- [x] OpenCode 全事件覆盖（tool_result/permission/file/session/task）
- [x] 权限通知 Desktop（permission_requested/decided）
- [x] 集成 smoke test 17/17 通过
- [x] OpenCode 集成测试
- [x] CI `-short` 标记：集成测试在 CI 正确跳过
- [x] 打通 Edge → Desktop WebSocket 事件投递验证

### Desktop（Leader + Agent）
- [x] 共享类型修复 + ChatView 实时打字 + ToolUseBlock + FileChangeBlock
- [x] RunDetail 标签页 + text_delta 累积 + 模型选择器
- [x] 12/12 测试文件全部通过 (123 tests)
- [x] 消费 run.agent.task_* → 子代理事件

### 工程基础
- [x] Go: .golangci.yml 22 规则 + ESLint/Prettier + typecheck
- [x] CI: lint + typecheck + coverage 72%（阈值 70%）
- [x] .codex/skills/cross-review 项目级 skill
- [x] 18 份参考报告

## P1 交互体验（进行中）

基于参考项目（OpenCode UI/Goose/LibreChat/Claude Code WebUI）的 UX 审计结果。

### 核心体验（原 P0 级）
- [x] ChatView: Markdown 渲染 + 代码语法高亮（react-markdown + PrismLight 12语言）
- [x] PromptInput: 多行 textarea + Stop 按钮（Enter发送/Shift+Enter换行）
- [x] RunDetail: Cancel/Abort 按钮 + token 用量展示（haiku agent 实现）

### 聊天标配（原 P1 级）✅ (全部完成 4/4)
- [x] ThreadPanel: 重命名/删除 + 消息/运行计数（sonnet agent）
- [x] DiffViewer: 单块 Accept/Reject 交互（haiku agent）
- [x] ChatView: 消息操作 — 复制/重试/删除 hover 按钮（haiku agent）
- [x] AgentList: 搜索过滤 + 描述 + 彩色能力标签 + 匹配高亮（haiku agent）

### P2 级（打磨）✅ (全部完成 4/4)
- [x] StatusBar: 延迟指示器 + 错误徽标 + 重连脉冲（haiku agent）
- [x] 加载骨架屏 + shimmer 动画（haiku agent）
- [x] 错误处理 UX: Edge 断连横幅 + ErrorBoundary Retry（haiku agent）
- [x] 全局暗/亮主题切换 + CSS 变量体系 + ThemeContext（sonnet agent）

### P3 级（性能 + 健壮）✅ (全部完成 3/3)
- [x] Bundle 分析 + React.lazy 拆分 + React.memo 审计（sonnet agent）
- [x] 权限事件管道：permission_requested/decided 事件 emit，Desktop 被动观察（自动批准，完整门控延迟到 M4）
- [x] 真实 Agent 集成 E2E：scripts/integration-e2e.ps1（启动edge→POST run→WebSocket验证）

### M3b 多 Agent 协调（研究员 P0 建议 ✅ 全部完成 6/6）
基于 `docs/reference/02-cross-comparison/00-synthesis.md` 的 18 项目全景分析。

| # | 采纳项 | 来源 | 状态 |
|---|--------|------|:--:|
| 1 | AgentHook 接口（6 核心 hook） | Claude Code + OpenCode | ✅ |
| 2 | 消息树渲染（ThreadPanel tree） | LibreChat buildTree | ✅ |
| 3 | 安全管道（23 检查 → Go） | Claude Code deep-dive | ✅ |
| 4 | Task 状态: dispatched | Multica | ✅ |
| 5 | Context Budget 模型 | Claude Code + LibreChat | ✅ |
| 6 | 流式增量解析器 | Kanna drainingStreams | ✅ |

### M4 候选（Workspace + 协作）
- [x] Hub Server 骨架：Go module + 18 REST 路由 + health check（stub 响应，待后端开发）
- [ ] OpenCode E2E：stdin 死锁已修复，进程正常退出（需 API key 配置）
- [ ] Codex E2E：二进制可用但未实测（需额度）
- [ ] 环境隔离：envForRun 传递完整父进程环境给 Agent CLI（MEDIUM，已知风险）
- [ ] Hub auth middleware：在 stub 转真实实现前必须接入
- [ ] 权限门控升级：Desktop 主动批准/拒绝
- [ ] Web 前端集成：feat/trump-webui → dev/delicious233 合并
- [ ] 响应式布局 + 移动端适配

## 实测状态 (2026-05-23)

| Agent | E2E 集成测试 | 单元测试 | 事件覆盖 | 备注 |
|-------|------------|---------|---------|------|
| Claude Code | ✅ 5/5 pass | ✅ 24 fixtures | 20+ types | 全链路验证通过 |
| OpenCode | ✅ 4/5 pass | ✅ 12 tests | 16 types | session_init+text_delta+finished, result 事件 schema 微调 |
| Codex | ❌ 未实测 | ✅ fixture tests | 9 item types | 需额度 |
| Hub Server | ✅ 骨架可运行 | — | 18 routes | 待后端开发 |

## 验收

- [ ] Desktop 启动 Edge → 发送 prompt → 看到 Claude Code 实时打字
- [ ] tool call 卡片正确渲染（tool_use → tool_result）
- [ ] Diff 在 ChatView 内联展示
- [ ] 102 测试通过
- [ ] client-smoke.ps1 全链路
