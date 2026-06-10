# BYTEDANCE.md — AgentHub 项目主文档

> 最后更新：2026-06-10
> 关联文档：`STATE.md`（当前事实）、`docs/roadmap.md`（路线图）、`docs/architecture.md`（架构边界）

---

## 1. 项目概述

AgentHub 是一个 **IM 形态的多 Agent 协作工作台**。用户面对的是联系人、群聊、项目会话、Agent 队友、审批、Diff、Preview 和产物，而不是一组 Runtime 下拉框。

### 核心价值

- **IM 即界面**：单聊、群聊、`@Agent`、Orchestrator 分派和上下文连续在同一条任务流里成立
- **产物内联**：代码 Diff、网页预览、文件附件、审批、部署状态和生成资产不散落在日志或后台页面
- **统一事件合同**：Web 远控、Desktop 本地执行、Mobile/IM 审批查看使用同一 Hub/Edge 事件合同
- **显式数据模式**：mock、fixture、observed、approved-real、production 必须显式区分

### 产品判断标准

- Agent Profile 回答"谁来做事"，Agent Runtime 回答"用什么执行"
- 真实登录、真实 CLI/model/API、部署、签名、公证和 release upload 都需要明确审批

---

## 2. 架构概览

```text
Web / Desktop / Mobile / IM
  → Hub 身份、会话、联系人、群聊、权限、路由、回放
  → Execution Target: Local Edge / Remote Edge / Cloud Edge / Hub Relay
  → Edge Runtime adapter: Claude Code / Codex / OpenCode / SDK / Custom
  → 类型化事件、审批、Diff、Preview、Artifact、执行记录
  → 同一条 IM 任务流渲染和控制
```

### 五层数据流

| 层 | 组件 | 端口 | 技术栈 |
|---|------|------|--------|
| 前端 | Web (5174) / Desktop (5173) / Mobile (Expo RN) | — | React + TypeScript + Vite + Tauri |
| 共享层 | app/shared/ | — | 共享 UI + 类型 + Platform Adapter 接口 |
| Hub Server | 身份、IM、路由、权限、审计 | 8080 | Go + Gin + PostgreSQL + Redis |
| Edge Server | 本地执行、Adapter 管理、事件持久化 | 3210 | Go + stdlib + SQLite |
| Runtime | CLI Adapters (Claude Code/Codex/OpenCode) + SDK Adapters | — | 子进程 + HTTP SSE |

### 四条数据线

| 线路 | 方向 | 协议 |
|------|------|------|
| 控制线 | Workbench → Hub/Edge REST → Runtime | REST JSON |
| 事件线 | Runtime → Edge EventStore → Hub WS → Transcript | WebSocket typed events |
| 证据线 | RunEvent → EvidenceRef → Inspector | REST + WS |
| 同步线 | Edge EventStore → Hub Sync → Viewers | REST + WS |

---

## 3. 团队与角色

| 角色 | 职责 |
|------|------|
| **Controller** | 最终集成、验证、fast-forward/push、release gate 审批 |
| **Worker** | 从可信基线开隔离 worktree 开发，不直接推 dev/master |
| **Operator** | 运行 approved-real 测试、执行部署、管理环境变量和密钥 |

### 分支治理

- 主开发分支：`dev/delicious233`，从 `origin/master` 创建
- 发布收口分支：`dev/release-0.3.0-rc7`
- 新实现必须从最新可信基线开隔离 worktree
- Worker 不直接推 `dev/delicious233`、`master` 或 tag
- 已合入或过时 worktree 只能在只读审计确认后逐个归档

---

## 4. 关键决策记录

### ADR-001: UI 作为需求文档

**决策**：非必要不碰 UI 层。UI 层的功能和业务作为需求文档，目标是调通数据流。

**理由**：UI 层已经实现了所有交互逻辑和视觉设计。数据管线（API 客户端、React Query hooks、Platform Adapter、WebSocket 事件路由）是"接线层"，应该完整对接真实后端。

### ADR-002: Hub 负责身份和社交，Edge 负责执行

**决策**：Web 只连接 Hub，不直接连接 Local Edge 或 raw runtime。Hub 负责账号、IM、同步、路由、权限、审计和远程控制面。Local Edge 负责本地执行、adapter 调用、runtime policy、日志和证据。

### ADR-003: 三层数据模式

**决策**：mock（JS 内存）、observed（Edge API 只读）、approved-real（真实 Hub+Edge+CLI）三层。real mode 不能静默降级。

### ADR-004: SDK Adapter 纯 HTTP 实现

**决策**：SDK adapters 不依赖外部 SDK 包，使用 Go 标准 `net/http` 实现 HTTP direct call + SSE streaming。

### ADR-005: TokenDance ID 作为统一身份源

**决策**：TokenDance ID 只证明身份；AgentHub 自己决定能做什么。Hub OIDC handler 负责 PKCE code exchange 和 Hub 本地 session 签发。

---

## 5. 部署拓扑

### 开发环境

| 服务 | 地址 | 状态 |
|------|------|------|
| Hub Server | http://127.0.0.1:8080 | ✅ 运行中 |
| Edge Server | http://127.0.0.1:3210 | ✅ 运行中 |
| TokenDance ID | http://127.0.0.1:3000 | ✅ 运行中 |
| Web Vite | http://127.0.0.1:5174 | 按需启动 |
| Desktop Vite | http://127.0.0.1:5173 | 按需启动 |
| PostgreSQL | localhost:5432 | Docker (`agenthub-postgres`) |
| Redis | localhost:6379 | Docker (`agenthub-redis`) |

### 生产环境 (hk2)

| 组件 | 配置 |
|------|------|
| 服务器 | 核云 VPS, Hong Kong, 38.76.183.116 |
| Docker 网络 | `agenthub-net` (172.18.0.0/16) |
| 反向代理 | Nginx + certbot SSL (`api.vectorcontrol.tech`) |
| OAuth | oauth2-proxy → TokenDance ID (`https://id.vectorcontrol.tech`) |
| Hub 镜像 | `ghcr.io/tokendancelab/agenthub-hub:latest` |
| 部署配置 | `hub-server/deployments/hk2/` |

### 启动命令

```bash
# Hub
cd hub-server && go run ./cmd/server-hub

# Edge (with Claude Code)
cd edge-server && go run ./cmd/agenthub-edge --store-backend memory --dev --agent-default claude-code --addr 127.0.0.1:3210

# TokenDance ID
cd ../tokendance-id && go run ./cmd/tokendance-id

# Web
cd app/web && npx vite --port 5174

# Desktop
cd app/desktop && npx vite --port 5173
```

### E2E 验证

```bash
pwsh -NoProfile -File tests/scripts/verify-real-api-smoke.ps1
```

---

## 6. 发布流程

1. **Pre-release 验证**：`verify-real-api-smoke.ps1` → ALL PASSED
2. **CI gate**：`verify-ci-gates.ps1` → PASS
3. **Tauri dry package**：`verify-tauri-package-dry.ps1` → PASS → 获取 SHA-256 hashes
4. **创建 RC tag**：`git tag -a v0.3.0-rc.N -m "..." && git push origin v0.3.0-rc.N`
5. **签名**（阻塞）：需要签名证书
6. **Release upload**（阻塞）：需要签名 artifacts
7. **部署 hk2**：`hub-server/deployments/hk2/deploy-hk2.sh`

### 当前 Release 状态

| 项目 | 状态 |
|------|------|
| RC8 tag | ✅ `v0.3.0-rc.8` 已创建 |
| E2E 验证 | ✅ 13 阶段，0 失败 |
| OIDC 验证 | ✅ PKCE 全流程 |
| CLI 真实执行 | ✅ Claude Code + OpenCode |
| Tauri unsigned package | ✅ Dry gate PASS |
| 签名发布 | ⚠️ 阻塞（签名证书） |
| hk2 部署 | ⚠️ 待部署 |

---

## 7. 安全规则

- Web 只连接 Hub，不直接连接 Local Edge 或 raw runtime
- Desktop renderer 不获得 raw process execution 权限
- Mock 和 fixture 模式必须显式；real mode 不能静默降级
- 未获明确审批，不跑真实登录、真实模型消耗、部署、签名、公证、updater、release upload
- TokenDance API key 不得暴露给浏览器 UI
- 所有 Hub API 必须经过 `AuthMiddleware` + `RequireHubSession`
- Desktop 文件操作必须经过 allowlist 和 typed Host API

---

## 8. 关键链接

- 仓库：https://github.com/TokenDanceLab/AgentHub
- TokenDance ID：https://id.vectorcontrol.tech
- Hub API：https://api.vectorcontrol.tech
- CI/CD：GitHub Actions
- 镜像注册：ghcr.io/tokendancelab/agenthub-hub
