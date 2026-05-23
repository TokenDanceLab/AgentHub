# AgentHub 路线图 — P0 集成冲刺

最后更新：2026-05-23

## 当前总目标

**打通 Edge→Desktop→Web 全链路。** 比赛 Demo 必须展示 IM 聊天式交互：用户在 Desktop 输入 prompt → Edge 调度 Agent CLI → 实时事件流回 Desktop UI → 产物（Diff/Preview）内联展示。

## 工作区

```
dev/delicious233          ← 主 dev（Leader）: ROADMAP + 架构决策
feat/p0-integration       ← P0 集成（new!）: Edge + Desktop 端到端
feat/trump-webui          ← Web 前端（Trump）
```

合并方向：`feat/* → dev/delicious233 → master`

## P0 冲刺任务

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
- [ ] CI `-short` 标记：集成测试在 CI 正确跳过
- [ ] 打通 Edge → Desktop WebSocket 事件投递验证

### Desktop（Leader + Agent）
- [x] 共享类型修复（4 阻塞不匹配）
- [x] ChatView 消费 run.agent.text_delta → 实时打字
- [x] ChatView 消费 run.agent.tool_call → ToolUseBlock 卡片
- [x] ChatView 消费 run.agent.tool_result → tool result 渲染
- [x] ChatView 消费 run.agent.file_change → FileChangeBlock
- [x] RunDetail Output/ToolCalls/FileChanges 标签页
- [x] RunDetail text_delta 累积到 outputText
- [x] 12/12 测试文件全部通过 (123 tests)
- [ ] PromptInput 模型选择器（model + reasoningEffort）
- [ ] POST /v1/runs 请求中带 model/reasoningEffort
- [ ] 消费 run.agent.task_* → 子代理事件

### Docs
- [x] archive/ 清理 7 份过时文档
- [x] 02-decide/ 03-build/ 添加实现状态标记
- [x] 18 份参考报告（01-learn/repos/01~18）
- [x] AGENTS.md 质量治理规则

## 验收

- [ ] Desktop 启动 Edge → 发送 prompt → 看到 Claude Code 实时打字
- [ ] tool call 卡片正确渲染（tool_use → tool_result）
- [ ] Diff 在 ChatView 内联展示
- [ ] 102 测试通过
- [ ] client-smoke.ps1 全链路
