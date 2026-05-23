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

### P0 级（阻塞核心体验）
- [x] ChatView: Markdown 渲染 + 代码语法高亮（react-markdown + PrismLight 12语言）
- [x] PromptInput: 多行 textarea + Stop 按钮（Enter发送/Shift+Enter换行）
- [x] RunDetail: Cancel/Abort 按钮 + token 用量展示（haiku agent 实现）

### P1 级（成熟聊天产品标配）
- [x] ThreadPanel: 重命名/删除 + 消息/运行计数（sonnet agent 实现: inline edit + confirm delete + PATCH/DELETE API）
- [x] DiffViewer: 单块 Accept/Reject 交互（haiku agent 实现: Check/X toggle + 透明度/删除线反馈）
- [x] ChatView: 消息操作（复制/重试/删除）→ haiku agent 实现
- [ ] AgentList: 搜索过滤 + 描述面板 + 标签 → haiku agent 进行中

### P2 级（打磨）
- [ ] PromptInput: 文件附件 + 斜杠命令 + 输入历史
- [ ] 全局暗/亮主题切换
- [ ] StatusBar: 延迟指示器 + 错误徽标

## 验收

- [ ] Desktop 启动 Edge → 发送 prompt → 看到 Claude Code 实时打字
- [ ] tool call 卡片正确渲染（tool_use → tool_result）
- [ ] Diff 在 ChatView 内联展示
- [ ] 102 测试通过
- [ ] client-smoke.ps1 全链路
