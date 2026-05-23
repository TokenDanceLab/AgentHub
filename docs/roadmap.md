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
- [ ] OpenCode 集成测试
- [ ] 打通 Edge → Desktop WebSocket 事件投递验证

### Desktop（Leader + Agent）
- [ ] 消费 run.agent.text_delta → ChatView 实时打字
- [ ] 消费 run.agent.tool_call → ToolUseBlock 卡片
- [ ] 消费 run.agent.tool_result → tool result 渲染
- [ ] 消费 run.agent.file_change → DiffCard 内联
- [ ] 消费 run.agent.result → 完成状态 + token 用量
- [ ] 消费 run.agent.task_* → 子代理事件
- [ ] POST /v1/runs 请求中带 model/reasoningEffort

### Docs
- [ ] archive/ 加归档标记
- [ ] 02-decide/ 03-build/ 标注实现状态

## 验收

- [ ] Desktop 启动 Edge → 发送 prompt → 看到 Claude Code 实时打字
- [ ] tool call 卡片正确渲染（tool_use → tool_result）
- [ ] Diff 在 ChatView 内联展示
- [ ] 102 测试通过
- [ ] client-smoke.ps1 全链路
