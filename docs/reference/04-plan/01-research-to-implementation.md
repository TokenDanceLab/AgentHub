# AgentHub 调研→实现综合路线图

> 基于 35 份调研文档 + 2026 竞争格局 + Claude Agent SDK GA

## 1. 优先级矩阵

### P0 — 现在必做（让 Claude Code 在 AgentHub 中跑起来）

| # | 行动项 | 来源文档 | 理由 |
|---|--------|----------|------|
| 1 | `api/` — REST API + WebSocket typed events | design-protocol.md | 所有模块的合同 |
| 2 | `runner/` — ClaudeCodeAdapter (CLI headless) | cross-analysis-adapters.md | 最小可行 Agent 执行 |
| 3 | `edge-server/` — local-api + runner-manager | design-go-services.md | 本地 WebSocket + Runner 管理 |
| 4 | SQLite schema + FTS5 索引 | design-eventstore-memory.md | 消息持久化 |
| 5 | `app/web/` — 三栏布局 + Thread 消息流 | design-desktop-ux.md | 用户可见的 UI |
| 6 | WebSocket Hub (coder/websocket) | scaffold-go-services.md | 实时消息推送 |
| 7 | Git worktree workspace 隔离 | cross-analysis-sandbox-tools.md | Agent 执行安全隔离 |
| 8 | `go.mod` + Makefile + CI | scaffold-go-services.md | 可构建的工程 |

### P1 — 强烈建议（群聊多 Agent 协作）

| # | 行动项 | 来源文档 | 理由 |
|---|--------|----------|------|
| 9 | Orchestrator — @mention 调度 | cross-analysis-orchestration.md | 群聊核心体验 |
| 10 | ContextBuilder — 6-step pipeline | design-context-builder.md | Agent 上下文管理 |
| 11 | PolicyEngine — 23 security checks | deep-dive-claude-code-tool-security.md | 安全审批 |
| 12 | CodexAdapter — rollout replay | cross-analysis-adapters.md | 第二个 Agent |
| 13 | EventStore — JSONL + Snapshot 2MB | design-eventstore-memory.md | 大日志持久化 |
| 14 | Diff 卡片 + Apply/Discard | design-desktop-ux.md + deep-dive-cloudcli-git-filetree.md | 代码审查闭环 |

### P2 — 增强（远程 + 多端）

| # | 行动项 | 来源文档 |
|---|--------|----------|
| 15 | Hub Server — 用户/联系人/群聊 | design-go-services.md |
| 16 | Hub-Edge sync — seq-based | design-protocol.md sync.proto |
| 17 | Claude Agent SDK Python sidecar | impact-analysis-claude-sdk-ga.md |
| 18 | PWA + 移动端适配 | design-desktop-ux.md |
| 19 | Checkpoint Timeline — SHA-256 + zstd | design-eventstore-memory.md |

### P3 — 远期（云端 + 团队）

| # | 行动项 | 来源文档 |
|---|--------|----------|
| 20 | Hub Relay 中继 | architecture.md topology |
| 21 | Cloud Edge + Docker sandbox | cross-analysis-sandbox-tools.md |
| 22 | 团队 Memory + Agent Marketplace | cross-analysis-orchestration.md |
| 23 | Tauri Desktop 壳 | web-research-tech-stack.md |

### P4 — 完整版

| # | 行动项 |
|---|--------|
| 24 | 好友系统 + 群聊管理 |
| 25 | E2EE Hub 中继加密 |
| 26 | Multi-tenant 权限 |

## 2. P0 最小可运行系统

### 目标
用户打开 `localhost:3000` → 输入 `@ClaudeCode 写一个登录页` → Claude Code 执行 → 看到实时 stdout 流 + Diff 卡片

### 最小文件清单（~30 个文件）

```
AgentHub/
├── go.mod, go.sum
├── Makefile
├── api/
│   ├── openapi.yaml        # REST API 契约
│   └── events.schema.json  # WebSocket event 契约
├── edge-server/
│   ├── cmd/main.go         # 入口: HTTP + WS + Runner管理
│   └── internal/
│       ├── local_api/      # REST: POST /runs, GET /messages
│       ├── local_ws/       # WebSocket: /events → UI 推送
│       └── runner_mgr/     # Runner 生命周期管理
├── runner/
│   ├── cmd/main.go         # 入口: 启动 Agent CLI
│   └── internal/
│       ├── executor/       # os/exec + context 子进程管理
│       ├── adapters/       # ClaudeCodeAdapter (cli -p)
│       └── workspace/      # git worktree add/remove
├── app/web/src/
│   ├── App.tsx
│   ├── components/
│   │   ├── Sidebar.tsx     # 会话列表
│   │   ├── ThreadView.tsx  # 消息流
│   │   └── ComposeArea.tsx # 输入框
│   └── hooks/
│       └── useWebSocket.ts
└── scripts/migrate.go
```

### 启动流程
```bash
# 1. 初始化 DB
go run scripts/migrate.go up

# 2. 启动 Edge
go run ./edge-server/cmd/main.go

# 3. 启动 Runner
go run ./runner/cmd/main.go

# 4. 启动前端
cd app/web && pnpm dev
```

## 3. 调研→实现映射矩阵

| 实现模块 | 参考调研文档 | 直接复用模式 |
|----------|-------------|------------|
| **AgentAdapter interface** | cross-analysis-adapters.md | 4 方法核心接口 + 3 扩展接口 |
| **ClaudeCodeAdapter** | cross-analysis-adapters.md Sec 3.1 | CLI headless NDJSON + 8 workaround |
| **CodexAdapter** | cross-analysis-adapters.md Sec 3.2 | rollout replay + config.toml 生成 |
| **EventStore** | kanna.md + design-eventstore-memory.md | writeChain 串行化 + 2MB snapshot + FTS5 索引 |
| **PolicyEngine** | deep-dive-claude-code-tool-security.md | 23 security checks + 9-source priority |
| **ContextBuilder** | design-context-builder.md | 6-step pipeline + reserveRatio(0.05) + EMA |
| **WebSocket Hub** | scaffold-go-services.md | coder/websocket + channel select + 多房间 |
| **SQLite Schema** | design-go-services.md Sec 4 | 11 表 + FTS5 虚拟表 + go:embed 迁移 |
| **消息树渲染** | deep-dive-librechat-message-tree.md | buildTree O(n) hashmap + SiblingSwitch |
| **Diff 卡片** | design-desktop-ux.md + cloudcli.md | parseCommitFiles + 行级评论 |
| **文件树** | cloudcli.md | 5-hook 解耦模式 |
| **Progressive Disclosure** | claude-code-viewer.md | 4 层递进展开 |
| **Fork 机制** | librechat.md | 4 种 Fork 模式 + UUID 重生成 |
| **MCP 集成** | deep-dive-claude-code-mcp-hooks.md | stdio/sse/streamableHTTP + mcp__命名 |
| **API/事件契约** | docs/protocol.md + api/ | OpenAPI + JSON Schema + typed events |
| **Tauri Desktop** | web-research-tech-stack.md | target-triple 命名 + shell plugin sidecar |
| **Auth (本地)** | deep-dive-claude-code-tool-security.md | Bearer token + 127.0.0.1 绑定 |

## 4. 关键决策

| 决策 | 选择 | 理由 | 来源 |
|------|------|------|------|
| Agent 接入方式 | CLI headless (P0) + Python SDK (P2) | CLI 最简稳定; SDK 提供更细粒度控制 | impact-analysis-claude-sdk-ga.md |
| 数据库 | SQLite + FTS5 (modernc.org) | 纯 Go 无 CGO; 嵌入式部署简单 | web-research-tech-stack.md |
| API 协议 | REST JSON + WebSocket typed events | 三人团队更易调试和落地；后续可按需生成类型 | docs/protocol.md |
| WebSocket 库 | coder/websocket | gorilla 已归档; 并发写安全 | web-research-tech-stack.md |
| 配置格式 | YAML (Agent) + TOML (Runner) | YAML 人类可读; viper 原生支持 | deep-dive-codex-agent-config.md |
| 沙箱方案 | Git worktree (默认) | 零依赖; <100ms 启动; git 原生 | cross-analysis-sandbox-tools.md |
| Monorepo 结构 | 单 module + cmd/ + internal/ | 三服务紧密耦合; Go workspace 本地开发 | design-go-services.md |
| 前端状态管理 | Zustand (10 stores) | 轻量; 与 React 天然配合 | design-desktop-ux.md |
| DI 方案 | Manual DI (P0) → Wire (P2) | 服务边界清晰; 避免框架复杂度 | design-go-services.md |

## 5. 竞争差异护城河

| 维度 | 竞品 | AgentHub 差异 |
|------|------|-------------|
| 交互范式 | CLI/IDE/画布 | **IM 群聊消息流** |
| Agent 绑定 | Ruflo→Claude Code | **多 CLI 统一 Adapter** |
| 部署模式 | 纯本地或纯云端 | **Hub-Edge-Runner 三级** |
| 协作模式 | 单人+AI | **人+多Agent 群聊** |
| 离线能力 | 大多需要联网 | **P0 本地离线可用** |
