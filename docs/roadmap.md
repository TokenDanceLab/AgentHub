# AgentHub 路线图

最后更新：2026-05-23

## Agent 接入策略

### 分层原则

```
第一层（Native Adapter）— 主力，深度掌控
  条件：协议公开或有参考源码
  做法：读取 CLI 源码/协议 → 完整 Native Adapter → 全量事件 + 双向控制
  
第二层（ACP Adapter）— 备选，广度覆盖
  条件：Agent 支持 ACP (Agent Client Protocol)
  做法：一个 ACP Adapter → 批量接入所有 ACP 兼容 Agent
  限制：仅 7-8 种基础事件，无子代理/压缩/diff/权限细节
```

**ACP 不替代 Native Adapter。** ACP 只能拿到 agent_message_chunk、tool_call、usage_update 等基础事件，缺少子代理生命周期（task_started/progress/notification）、文件 diff、上下文压缩通知、API 重试详情、hook 事件、速率限制等 Claude Code 的完整能力。

### Agent 接入优先级

| 优先级 | Agent | 路线 | 开源 | 理由 |
|--------|-------|------|------|------|
| P0 done | Claude Code | Native (NDJSON + stdin) | 协议公开 | 主力 agent，已实现 24 消息类型 + 控制协议 |
| P0 active | OpenCode | Native (`--format json` → SSE/ACP) | MIT | 多 Provider，ACP 双通道 |
| P1 | Goose | Native (Rust, ACP + 原生) | Apache 2.0 | 架构最像 AgentHub，Provider trait + SessionEventBus |
| P1 | Aider | Native (edit-format 策略) | Apache 2.0 | 独特 diff 策略模式，终端优先 |
| P2 | Roo-Code | 借鉴 (class hierarchy) | Apache 2.0 | tool call start/delta/end 流生命周期 |
| P2 | mindfs | 借鉴 (Pool + ACP) | 未标注 | Pool 路由模式、Stream Hub replay |
| 备选 | Gemini CLI | ACP | Google | 走 ACP 通用 adapter |
| 备选 | Cursor/Cline/Copilot 等 | ACP | 各开源 | 走 ACP 通用 adapter，不逐一适配 |

## 当前总目标

Desktop M3 收口——已完成 M2 设计系统+状态管理+渐进展开，M3.1 消息树+DiffViewer。Edge AgentAdapter 已具备完整 NDJSON 协议。Web 前端 5 页面预览壳已上线。

## 当前活跃分支

```
dev/delicious233          ← 主 dev（Delicious233）: Desktop M3 + Edge + 共享
dev/trump                 ← Trump dev: Web 前端 + 同步 Desktop

feat/desktop-sidecar      ← Desktop 工作区 → dev/delicious233
feat/edge-adapters        ← Edge 工作区 → 已合入 dev/delicious233
feat/trump-webui          ← Web 工作区 → dev/trump

feat/frontend-page-preview ← 归档（Trump 旧 HTML mockup）
feat/frontend-webui        ← 归档（Trump 旧分支）
```

合并方向：`feat/* → dev/delicious233 → dev/trump → (review) → dev/delicious233 → master`

## 路线图分层

- 总路线图：`docs/roadmap.md`
- 前端路线图：`docs/roadmaps/frontend.md`
- 后端路线图：`docs/roadmaps/backend.md`
- 客户端路线图：`docs/roadmaps/client.md`
- 分支路线图：`docs/roadmaps/branches/<branch-name>.md`

## 基本原则

- Go 优先：Hub Server、Edge Server 使用 Go。
- 协议简单：REST JSON API + WebSocket typed events 是当前主线。
- UI 使用 React + TypeScript。Desktop 使用 Tauri v2。Web 使用 Vite。
- 设计系统：OKLCH 色彩空间、shadcn 语义 token、3 字号 + 2 字重 + 零阴影。
- 状态管理：Zustand 工厂模式（客户端状态）、WebSocket 事件只做增量。
- Runner 策略：AgentHub 不实现自己的 Agent 架构——Claude Code/Codex/OpenCode 作为 Runner。
- AgentHub 负责：进程管理、工作区隔离、CLI 输出解析、Diff 查看、审批桥接、IM 聊天。

## M2 完成项（Desktop 基础架构）

<<<<<<< HEAD
- [x] M1 客户端本地链路：Desktop Shell + Local Edge + Mock Runner + smoke test。
- [ ] M2 Edge 本地数据层：Project / Thread / Run / Item / EventStore。最小内存实现已在 PR #30，message/item 写入链路、Runner lifecycle 边界、store 接口边界、轻量 JSON 文件持久化实现和 `--store-file` 启动参数已补齐，SQLite 仍是后续可选评估项。
- [ ] M3 真实 Runner：CLI Agent 进程、取消、日志、错误映射。本地进程 executor、本地进程工作目录边界、generic adapter profile / 命令模板最小层和仓库自带 mock Runner preset 已补齐，`dbd4583` 已实现 AgentAdapter 层，Edge 直接对接 CLI 原生协议。当前重点是增强各 adapter。
- [ ] M3a Agent Adapter 增强：对标 Claude Desktop 能力完备度。NDJSON 解析器已从 5 种扩展到 20+ 种消息类型，stdin 控制协议已实现（can_use_tool/interrupt/set_model/set_permission_mode/stop_task），多轮会话已支持（--resume/--continue/--fork-session），OpenCode --format json 结构化解析已完成，runnerctx 共享包消除了 RunProcessContext 重复定义，adapter-aware cancel 已实现，24 个 NDJSON parser 单元测试 + 6 个集成测试已添加。后续重点：ACP Adapter 通用接入层、PermissionBroker 权限代理、InteractiveControl 扩展接口。
  - Phase 1: Bug 修复 ✅ done
  - Phase 2: Claude Code NDJSON 完整协议 + stdin 控制协议 ✅ done (`6bdb1f8`)
  - Phase 3: OpenCode `run --format json` + session 支持 ✅ done (`6bdb1f8`)
  - Phase 4: adapter-aware cancel ✅ done (`a8a2411`)
  - Phase 5: 集成测试 ✅ done (`a22186d`)
  - Phase 6: ACP Adapter — 通用接入层，批量支持 ACP 兼容 agent
  - Phase 7: PermissionBroker + InteractiveControl 扩展接口
  - Phase 8: Codex `exec --json` + app-server JSON-RPC（需要 API 额度）
- [ ] M4 Workspace 能力：worktree、diff、preview、artifact、approval。
- [ ] M5 Hub 协作链路：Edge-Hub sync、远程查看、远程审批。
=======
| 模块 | 内容 | 状态 |
|------|------|------|
| OKLCH tokens.css | hex→OKLCH, 3字号+2字重+零阴影, dark/light 双主题 | ✅ |
| CSS Module 迁移 | 9 文件旧 token→新 OKLCH, srgb→oklch | ✅ |
| Zustand stores | uiStore, connectionStore, threadStore, runStore | ✅ |
| App.tsx 重构 | useState→Zustand selectors | ✅ |
| 渐进展开 L0-L2 | 条件渲染替代 details/summary, ThinkingBlock+ToolUseBlock | ✅ |
| DiffCard 内联 | 文件头+统计+hunk预览, agenthub:open-diff 事件 | ✅ |
>>>>>>> dev/delicious233

## M3 进行中（消息树 + 事件持久化）

<<<<<<< HEAD
- 前端：从 Mock 数据过渡到真实 REST / WebSocket client，承接 UI 同学设计。
- 后端：实现 Hub Server、Edge-Hub 通信、账号/群聊/同步/中继能力。
- 客户端：PR #30 推进 Edge 本地数据层，消息/Item 写入链路、Runner lifecycle 边界、store 接口边界、JSON 文件持久化和 `--store-file` 启动参数已补齐，`dbd4583` 已实现 AgentAdapter 层，Edge 直接对接 CLI 原生协议。M3a Phase 1-5 已完成（`6bdb1f8` NDJSON + 控制协议 + OpenCode Phase 2，`a8a2411` adapter-aware cancel，`a22186d` 集成测试）。参考研究覆盖 14 个开源项目（Claude Code source/Codex/OpenCode/Goose/Kanna/Cline/Roo-Code/Continue/Aider/Crush/OpenHands/ChatDev/mindfs/Orca），产出 5 份学习报告（`docs/reference/01-learn/repos/13~17`）。
=======
| 模块 | 内容 | 状态 |
|------|------|------|
| message-tree | buildTree O(n), flattenActivePath, DIRECT_PATH/INCLUDE_BRANCHES fork | ✅ |
| SiblingSwitch | 分支导航 ← 2/5 → | ✅ |
| DiffViewer | unified diff, 折叠文件头, hunk 渲染 | ✅ |
| EventStore JSONL | 追加写入 + 2MB 快照 + zstd 压缩 | ⏳ |
| Context Builder | 6 步管线 + reserveRatio=0.05 | ⏳ |
>>>>>>> dev/delicious233

## M4 计划

| 模块 | 内容 |
|------|------|
| 权限桥接 | ResolveOnce 竞速：CLI 触发→UI 响应 |
| 工作区隔离 | git worktree per run (Emdash WorktreeHost 模式) |
| 文档同步 | system-architecture.md / implementation-guide.md 更新 |
| e2e 收口 | client-smoke.ps1 全链路 |

## Desktop 测试

当前 123/123 单测通过 (Vitest)。覆盖：
- API client / errors / hooks / eventClient（原有 30）
- ChatView / AgentList / PromptInput / ThreadPanel / RunDetail（新增 81）
- useChatMessages（新增 25，含 tool_use 层级嵌套）
- message-tree（新增 12，buildTree/flattenActivePath/fork/cycle detection）
