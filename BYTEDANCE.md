# BYTEDANCE.md — AgentHub 项目主文档

> 最后更新：2026-06-10
> 关联文档：`STATE.md`（当前事实）、`docs/roadmap/`（路线图）、`docs/architecture.md`（架构边界）

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

**决策**：SDK adapters 不依赖外部 SDK 包，使用 Go 标准 `net/http` 实现 HTTP direct call + SSE streaming。`BuildCommand` 返回跨平台 no-op 哨兵命令（`true` / `cmd /c exit 0`），`ParseStream` 直接发 HTTP 请求并解析 SSE 事件流。

**实现细节**：
- **Anthropic SDK adapter**（`anthropic-sdk`）：直接 HTTP 到 Messages API (`/v1/messages`)，SSE streaming，支持 thinking mode（`budget_tokens`）、tool calls、multi-turn history
- **OpenAI SDK adapter**（`openai-sdk`）：直接 HTTP 到 Chat Completions API (`/v1/chat/completions`)，SSE streaming，支持 reasoning effort、structured output schema、reasoning content
- 两个 adapter 均支持 `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` 环境变量自定义 base URL（自动去除末尾 `/v1` 防止路径重复），适配代理网关
- 启用方式：`--anthropic-sdk-path` 和 `--openai-sdk-path` flags（也支持 `AGENTHUB_ANTHROPIC_SDK_PATH` / `AGENTHUB_OPENAI_SDK_PATH` 环境变量）
- E2E 测试通过 `api.vectorcontrol.tech` 代理网关验证，结果记录在 `tests/results/adapters-e2e-2026-06-10.md`

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

## 8. cc-switch 透明代理集成

cc-switch 是一个本地透明代理，位于 Claude Code / Codex 和上游 API 提供商之间。它重写请求，使 Claude Code 认为在与 Anthropic 对话，但实际后端可能是 DeepSeek、GLM、Qwen 等模型。

### 架构

```text
Claude Code / Codex
  → cc-switch proxy (本地 SQLite 配置)
  → 上游 API provider (DeepSeek / GLM / Qwen / ...)
```

cc-switch 维护一个 SQLite 数据库（`~/.cc-switch/cc-switch.db`），存储 provider 配置、model alias 映射和 proxy routing 状态。Edge Server 启动时自动检测 cc-switch 安装状态。

### Edge 集成

Edge Server 通过 `ccswitch` 包（`edge-server/internal/ccswitch/`）读取 cc-switch 数据库：

- **`ccswitch.Detect()`**：探测本地 cc-switch 安装状态（`CCSwitchStatus`），包括 `Installed`、`RoutingActive`、`ProxyPort`、`ActiveAppTypes`
- **`ccswitch.Reader`**：读取 provider 配置和 model alias 映射（`ProviderModelMapping`），支持按 `app_type` 过滤
- **`Reader.ResolveModelAlias(alias, appType)`**：将 Claude Code model alias（如 `claude-sonnet`）解析为 cc-switch 路由的实际 model

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/ccswitch/status` | GET | cc-switch 安装状态、routing 是否活跃、proxy 端口 |
| `/v1/ccswitch/providers` | GET | 当前 provider 配置、model alias 映射、base URL |

### Model Catalog 联动

`model_catalog.go` 中的 `addCcSwitchDBCatalog` 将 cc-switch 数据库中的透明代理映射注入 Edge model catalog，使前端能展示"用户选择 claude-sonnet → 实际路由到 deepseek-v4-pro"的完整映射链。

---

## 9. AgentMemory 文件系统

AgentHub 实现了基于文件系统的 Agent Memory 机制，允许跨会话、跨 agent 持久化上下文信息。

### 目录结构

```text
{workspace}/
  .agenthub/
    memory/
      project.md          # 项目级事实（所有 thread/agent 共享）
      thread_{threadID}.md # 线程级上下文
      agent_{agentID}.md   # Agent 级偏好和记忆
```

### 文件格式

每个 entry 使用 YAML frontmatter + Markdown body：

```markdown
---
id: project-onboarding
source: system
tags: [context, preference]
created: 2026-06-10T12:00:00Z
updated: 2026-06-10T12:00:00Z
---

这是项目记忆文件。AgentHub 会在每次运行前加载此处的条目。
```

- `source` 取值：`user`、`agent`、`system`
- `tags` 为可选的 inline YAML 数组
- 单文件可包含多个 entry（多组 `---` 分隔）

### 注入链路

```
ReadMemory(workDir, threadID, agentID)
  → 按作用域读取 project.md + thread_{id}.md + agent_{id}.md
  → 格式化为 [AgentHub Memory - {category}] 区块
  → BuildMemoryPrompt() 生成完整 prompt 文本
  → 注入到 SkillsPrompt → RunProcessContext.AppendSystemPrompt
  → 传递给 agent adapter 的 system prompt
```

Memory 目录不存在时不报错（memory 是可选的），首次写入时 `EnsureMemoryDir` 自动创建并生成 onboarding 文件。

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/memory` | GET | 读取指定 workspace/thread/agent 的 memory entries |
| `/v1/memory` | POST | 写入或追加 memory entry（支持 overwrite 模式） |

---

## 10. 右侧栏增强（14 项）

RightInspector 组件（`app/shared/src/workbench/RightInspector.tsx`，800+ 行）是右侧检视面板的核心，包含 overview / browser / files 三个 tab。本次会话完成了 14 项增强：

### Files tab — 文件预览格式（10 项）

| # | 格式 | 渲染方式 | 依赖 |
|---|------|----------|------|
| 1 | PDF `.pdf` | `<iframe>` 浏览器原生 PDF viewer | 无 |
| 2 | Markdown `.md` | `MarkdownRenderer`（已有） | 无 |
| 3 | Code `.ts/.py/.go/...` | `CodeBlock`（已有） | 无 |
| 4 | HTML `.html` | `<iframe srcDoc>` 沙箱 | 无 |
| 5 | 图片 `.png/.jpg/.gif/.svg` | `<img>` + lightbox zoom | 无 |
| 6 | **PPT/PPTX** `.ppt/.pptx` | `pptxjs` → canvas slideshow + 缩略图条 | `pptxjs@3.x` |
| 7 | **Excel/CSV** `.xlsx/.csv` | SheetJS → 可排序表格 | `xlsx@0.18` |
| 8 | **DOCX** `.docx` | `mammoth.js` → HTML 渲染 | `mammoth@1.x` |
| 9 | Deploy URL | Browser tab 自动切换到部署 URL | 无 |
| 10 | TXT/LOG `.txt/.log` | `<pre>` 等宽纯文本 | 无 |

新增依赖共 ~350KB gzip（仅浏览器端，不影响 Edge/Hub 后端）。

### Overview tab — 运行状态（3 项）

| # | 组件 | 说明 |
|---|------|------|
| 11 | **AgentStreamingBar** | 2+ Agent 并发时显示头像+状态图标，完成后消失 |
| 12 | **ContextUsage** | 显示 token 用量，接近阈值时变色 |
| 13 | **DagTree** | AgentTeam 任务树状显示节点+状态图标+用时（`<ul>` 缩进树，非力导向图） |

### Browser tab — 部署预览（1 项）

| # | 功能 | 说明 |
|---|------|------|
| 14 | **部署 URL 自动切换** | Agent 部署成功后 Browser tab 自动切换到部署 URL |

---

## 11. Roadmap 模块化结构

Roadmap 已从单一 `docs/roadmap.md` 拆分为 `docs/roadmap/` 模块化目录，每条子文档聚焦一类工作：

| 文档 | 内容 |
|------|------|
| `00-state.md` | 已完成能力清单、未接通 gap、当前数据流状态 |
| `01-pipeline.md` | 不需要新 UI 的纯后端/合同层接线 |
| `02-light-ui.md` | 复用现有组件+少量 CSS 的轻接线 |
| `03-right-panel.md` | 右侧 inspector 内的新 UI 面 |
| `04-competition-gap.md` | 竞品强项对照+威胁评估 |
| `05-release-gates.md` | 功能完成验收标准+release gate 清单 |

设计原则：不动主聊天流（TranscriptView + Composer），只动后端/合同层和右侧检视面板。

---

## 12. 会话统计（2026-06-10）

本次开发会话的关键数据：

| 指标 | 数值 |
|------|------|
| Commits（2026-06-08 起） | 20+ 个功能/修复 commit |
| 文件变更 | 178 files changed |
| 代码量 | 21,276 insertions, 723 deletions |
| 部署 subagents | 30+ 个 subagent 会话（code review、E2E 测试、文档生成、UI 接线） |
| E2E 验证报告 | 4 份（adapter E2E、real web、smoke、Hub API） |
| 新 Edge API 端点 | `/v1/ccswitch/status`、`/v1/ccswitch/providers`、`/v1/memory`（GET/POST） |

---

## 13. 关键链接

- 仓库：https://github.com/TokenDanceLab/AgentHub
- TokenDance ID：https://id.vectorcontrol.tech
- Hub API：https://api.vectorcontrol.tech
- CI/CD：GitHub Actions
- 镜像注册：ghcr.io/tokendancelab/agenthub-hub
