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

推进 M2 Edge 本地数据层，让前端、后端、客户端三条线能围绕稳定的 Project / Thread / Run / Item / Event 模型并行开发。当前客户端 PR #30 已提供内存态最小实现，`feat/client-thread-messages-delicious233` 已补 message/item 写入链路，`feat/client-run-lifecycle-delicious233` 已抽出 Runner lifecycle 边界，`feat/client-store-boundary-delicious233` 已抽象 Edge store 接口边界，`feat/client-store-persistence-delicious233` 已提供轻量 JSON 文件持久化实现，`feat/client-edge-store-file-flag-delicious233` 已接入 Edge 启动参数 `--store-file`，`feat/client-runner-process-adapter-delicious233` 已补本地进程 executor 边界，`feat/client-runner-workdir-delicious233` 已补本地进程工作目录边界，`feat/client-runner-adapter-profile-delicious233` 已补 generic adapter profile / 命令模板最小层，`feat/client-runner-profile-preset-delicious233` 已补 `agenthub-runner-mock` preset 入口，`feat/client-runner-context-delicious233` 已让仓库自带 Runner mock 读取 Edge 注入的 Run 上下文，`feat/client-runner-edge-smoke-delicious233` 已补 Edge ProcessExecutor 启动仓库 Runner mock CLI 的集成测试，`feat/client-httpserver-runner-wiring-delicious233` 已补 Edge HTTP server 将 ProcessExecutor 装配进 Handler 的测试，`feat/client-smoke-runner-context-delicious233` 已补本地 smoke 对 Edge -> Runner mock 上下文输出的验证，`dbd4583` 已实现 AgentAdapter 层，删除 Runner 二进制，Edge 直接对接 CLI 原生协议。当前重点是增强各 adapter，对标 Claude Desktop 的能力完备度。

## 路线图分层

- 总路线图：`docs/roadmap.md`
- 前端路线图：`docs/roadmaps/frontend.md`
- 后端路线图：`docs/roadmaps/backend.md`
- 客户端路线图：`docs/roadmaps/client.md`
- 分支路线图：`docs/roadmaps/branches/<branch-name>.md`

## 基本原则

- Go 优先：Hub Server、Edge Server、Runner 使用 Go。
- 协议简单：REST JSON API + WebSocket typed events 是当前主线。
- 中文优先：README、AGENTS、issue、PR 和项目文档中文为主；代码标识保持英文。
- 隐私安全：本机状态、密钥、真实服务器信息和个人路径不进仓库。
- 渐进式加载：先读 `AGENTS.md` 和任务相关主文档，不全文扫描调研资料。

## 里程碑

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

## 当前活跃方向

- 前端：从 Mock 数据过渡到真实 REST / WebSocket client，承接 UI 同学设计。
- 后端：实现 Hub Server、Edge-Hub 通信、账号/群聊/同步/中继能力。
- 客户端：PR #30 推进 Edge 本地数据层，消息/Item 写入链路、Runner lifecycle 边界、store 接口边界、JSON 文件持久化和 `--store-file` 启动参数已补齐，`dbd4583` 已实现 AgentAdapter 层，Edge 直接对接 CLI 原生协议。M3a Phase 1-5 已完成（`6bdb1f8` NDJSON + 控制协议 + OpenCode Phase 2，`a8a2411` adapter-aware cancel，`a22186d` 集成测试）。参考研究覆盖 14 个开源项目（Claude Code source/Codex/OpenCode/Goose/Kanna/Cline/Roo-Code/Continue/Aider/Crush/OpenHands/ChatDev/mindfs/Orca），产出 5 份学习报告（`docs/reference/01-learn/repos/13~17`）。

## 验收门槛

- [ ] 当前分支路线图已更新。
- [ ] 相关方向路线图已更新。
- [ ] 测试或确定性检查已运行。
- [ ] API 或事件变化已同步 `api/`。
- [ ] `git status --short --branch` 已检查。

## 待办池

- [x] 抽象 Edge store 可替换接口边界。
- [x] 增加 Edge store 轻量 JSON 文件持久化实现；SQLite 依赖获取问题保留为后续可选评估。
- [x] 为 Edge 启动入口接入可选 `--store-file <path>`，未传时继续使用内存 store。
- [x] 在客户端 M2 基础上补 `POST /v1/threads/{threadId}/messages` 到 Item / event 的写入链路。
- [x] 增加 Edge 本地进程 executor 边界，支持 stdout/stderr、成功、失败和取消事件映射。
- [x] 为 Edge 本地进程 executor 增加工作目录配置边界；这只是本地进程 workdir 能力，不是完整真实 Runner adapter。
- [x] 为 Edge 本地进程 executor 增加 generic adapter profile / 命令模板最小层，支持从 Run 上下文展开 args/env。
- [x] 为 Edge 启动入口增加 `--runner-profile agenthub-runner-mock` preset，默认使用仓库自带 Runner mock CLI。
- [x] 让仓库自带 `agenthub-runner --mock` 读取 Edge 注入的 Run / Project / Thread 环境变量，并在 stdout 输出稳定上下文行。
- [x] 增加 Edge ProcessExecutor 到仓库 Runner mock CLI 的集成测试，覆盖 `run.started`、stdout `run.output.batch`、上下文输出和 `run.finished`。
- [x] 增加 Edge HTTP server 到 ProcessExecutor 的装配测试，覆盖默认 mock 延迟装配和配置进程 executor 后的 `POST /v1/runs` 启动链路。
- [x] 补强 `scripts/client-smoke.ps1`，默认自启动 Edge 时接入 Runner mock binary，并通过 WebSocket 验证当前 run 的 stdout 上下文。
- [x] 将 Runner 真正接入 Edge Run lifecycle，替换 handler 内置 mock flow。（`dbd4583` 已实现 AgentAdapter 层）
- [ ] M2 完成后归档或更新 `docs/client-roadmap.md`，避免路线图重复。
- [ ] 为 Runner 真实 CLI adapter 规划最小测试夹具。（已纳入 M3a Phase 6）
