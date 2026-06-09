# AgentHub

AgentHub 是一个面向 AI Agent 团队协作的开源工作台。它把 Web、Desktop、Mobile、Hub Server、Edge Server 和多种 CLI Runtime 连接到同一条协作链路，让用户在类似 IM 的界面里创建项目、拉起 Agent、审批任务、查看回放和管理本地执行目标。

[English](README_EN.md) · [官网](https://hub.vectorcontrol.tech) · [路线图](docs/roadmap.md) · [API](api/)

![status](https://img.shields.io/badge/status-active_development-blue?style=flat-square)
![version](https://img.shields.io/badge/version-0.3.0--rc.7-orange?style=flat-square)
![go](https://img.shields.io/badge/go-1.25+-00ADD8?style=flat-square&logo=go)
![react](https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react)
![license](https://img.shields.io/badge/license-Apache--2.0-lightgrey?style=flat-square)

## 当前状态

AgentHub 正在进入 `v0.3.0-rc.7` 候选阶段。当前主线优先级是稳定 `dev/delicious233`，再合入 `master`，然后发布 Windows Desktop 与 Android 预览版本。

| 模块 | 状态 | 说明 |
|---|---|---|
| Web 工作台 | 可开发验证 | 已接 Hub 项目、任务、审批、Artifact、项目群线程和 Agent 消息合同 |
| Desktop 工作台 | 可开发验证 | Tauri 2，本地 Edge/CLI readiness 和 Windows 打包门禁正在收口 |
| Mobile | 已合入 dev | Expo / React Native 路线已进入 `app/mobile-rn`，Android/iOS release gate 仍需设备证据 |
| Hub Server | 可开发验证 | 项目、AgentProfile、ExecutionTarget、任务、审批和消息合同已持续收口 |
| Edge Server | 可开发验证 | CLI adapter、SQLite readiness、SDK fixture 和本地执行证据仍在强化 |
| 真实登录/真实 CLI | 未标记完成 | TokenDanceID 与真实 CLI/model/API 需要单独的 approved-real 证据，不用 fixture 代替 |

## 快速开始

### 环境

- Go 1.25+
- Node.js 20+
- pnpm / Corepack
- Windows Desktop 打包需要 Rust、Tauri 依赖和 Windows toolchain

### 安装依赖

```powershell
git clone https://github.com/TokenDanceLab/AgentHub.git
cd AgentHub
corepack enable
corepack pnpm install --dir app --frozen-lockfile
```

### 启动 Hub Server

```powershell
cd hub-server
go test ./... -short
go run ./cmd/agenthub-hub
```

### 启动 Web

```powershell
cd app
corepack pnpm --filter agenthub-web dev
```

### 启动 Desktop

```powershell
cd app
corepack pnpm --filter agenthub-desktop dev
```

Desktop 会通过 Local Edge/sidecar 连接本机执行目标。真实 CLI 调用需要本机已安装并配置对应 CLI，并通过 readiness gate 证明 no-secret / no-spend 边界。

## 架构

```text
Web / Desktop / Mobile
        |
        v
Hub Server  <---->  TokenDanceID
        |
        v
Local Edge / Remote Edge
        |
        v
Claude Code / Codex / OpenCode / SDK fixtures
```

| 目录 | 作用 |
|---|---|
| `app/web` | 浏览器工作台 |
| `app/desktop` | Tauri Desktop 工作台 |
| `app/mobile-rn` | Expo / React Native Mobile |
| `app/shared` | 共享 UI、类型、transcript、API client |
| `hub-server` | Hub API、账号会话、项目、任务、消息、审批 |
| `edge-server` | 本地执行节点、CLI adapter、SQLite store、事件回放 |
| `api` | OpenAPI 与事件合同 |
| `tests/scripts` | release、readiness、approved-real 证据门禁 |
| `docs` | 路线图、状态、架构和治理文档 |

## 能力边界

| 能力 | 当前口径 |
|---|---|
| Mock / fixture | 用于本地开发、CI 和无密钥证明，不能声明为真实登录或真实模型执行 |
| Real mode | 需要 TokenDanceID、Hub、Desktop/Edge、CLI adapter 和脱敏证据同时通过 |
| Windows Release | 允许先走 unsigned / artifact-only readiness，正式签名和 updater 发布需要单独批准 |
| Android Release | Mobile 已合入 dev，正式 release 需要 dev-build/device/AuthSession/SecureStore/Push/Hub 证据 |
| macOS Release | 目前只保留 policy gate；签名、公证和上传不在默认 release 流程内 |

## 常用验证

```powershell
# Web
cd app
corepack pnpm --filter agenthub-web typecheck
corepack pnpm --filter agenthub-web test

# Hub
cd ..\hub-server
go test ./... -short

# Edge
cd ..\edge-server
go test ./... -short

# Release readiness
cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-release-gate.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-token-dance-id-login-readiness.ps1 -RepoRoot .
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-p0-approved-real-gold-path.ps1 -RepoRoot .
```

## 发布节奏

1. `dev/delicious233` 先达到完整绿色 CI。
2. 清理或关闭已过时的 PR 与 worktree。
3. 新建 `dev/delicious233 -> master` promote PR。
4. 合入 `master` 后打 `v0.3.0-rc.7` tag。
5. 生成 Windows Desktop 和 Android 预览证据；签名、公证、商店发布另走批准。

## 文档

- [路线图](docs/roadmap.md)
- [当前状态](STATE.md)
- [架构文档](docs/architecture.md)
- [API 合同](api/)
- [安全风险台账](docs/governance/security-risk-register.md)
- [TokenDanceID 登录 readiness](docs/audit/token-dance-id-login-readiness.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
