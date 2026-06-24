# AgentHub 项目概览

> 生成日期：2026-06-19 | Phase 1 分析 | Spec-Driven Develop

## 目录结构

| 顶层目录 | 用途 |
|---|---|
| `hub-server/` | Go 后端 (port 8080)：OIDC RP、IM、AgentTeam、REST/WS、同步/中继 |
| `edge-server/` | Go 后端 (port 3210)：本地执行、Thread/Run 生命周期、Runtime 适配器、EventStore |
| `pkg/` | 共享 Go 库（当前为空目录） |
| `app/` | pnpm monorepo：desktop、web、mobile-rn、shared |
| `app/shared/` | 共享 UI 组件、transcript 合约、composer、inspector、platform adapter、i18n |
| `app/desktop/` | Tauri v2 + React 19 (Vite port 5173)，捆绑 edge-server 为 sidecar |
| `app/web/` | React 19 Web (Vite port 5174)：Hub REST/WS client |
| `app/mobile-rn/` | Expo SDK 56 + RN 0.85 (port 5177)：OIDC deep-link、SecureStore |
| `api/` | API 合约：openapi.yaml (235KB) + events.md |
| `docs/` | 架构文档 (6 子模块)、ADR、roadmap、governance、audit |
| `scripts/` | 80+ PowerShell/Bash 脚本：dev、CI 验证、release、smoke tests |
| `.github/workflows/` | 6 个 CI/CD workflow：checks、release、cd-*、release-readiness |
| `reference/` | 参考实现（Codex、LibreChat 等），不构建 |

## 技术栈

### 后端

| 组件 | 语言 | 框架 | 数据库 | 关键依赖 |
|---|---|---|---|---|
| Hub Server | Go 1.25.0 | Gin v1.12 | PostgreSQL 16 (GORM)、Redis 7 | golang-jwt、coder/websocket、viper、zap、prometheus、aws-sdk-go-v2 (S3)、golang-migrate、ants/v2 |
| Edge Server | Go 1.25.0 | net/http | SQLite (modernc.org/sqlite) | gorilla/websocket、golang-jwt、prometheus |

### 前端

| 组件 | 框架 | 构建 | 测试 | 关键依赖 |
|---|---|---|---|---|
| Desktop | React 19、Tauri 2 | Vite 6.3、tsc 5.8 | Vitest 4.1、Playwright | @tauri-apps/api、@tanstack/react-query、zustand、i18next |
| Web | React 19 | Vite 6.3、tsc 5.8 | Vitest 4.1、Playwright | @tanstack/react-query、zustand、i18next |
| Mobile | RN 0.85、Expo SDK 56 | Metro | Vitest 4.1 | expo-auth-session、expo-secure-store |
| Shared | React 19 (peer) | tsc 5.8 | Vitest 4.1 | prismjs、jszip、diff、dompurify、xlsx |

### Desktop Rust Sidecar

| 组件 | 运行时 | 关键 crate |
|---|---|---|
| Tauri Host | Rust 2021、Tauri 2.x | tauri (tray, devtools)、tauri-plugin-shell/dialog/notification/updater、keyring-core、serde、tokio、reqwest (rustls-tls) |

## 启动入口

```bash
# Hub Server
cd hub-server && go run ./cmd/server-hub

# Edge Server
cd edge-server && go run ./cmd/agenthub-edge

# Desktop 开发
cd app/desktop && pnpm dev         # Vite only
cd app/desktop && pnpm tauri dev   # Tauri + Vite

# Web 开发
cd app/web && pnpm dev             # Vite port 5174

# Mobile 开发
cd app/mobile-rn && pnpm dev       # Expo port 5177
```

## 模块通信

```
Desktop (React) ──REST/WS──> Edge Server (本地)     # Run 生命周期
Desktop (React) ──REST/WS──> Hub Server              # 认证/OIDC/IM/同步
Web (React)     ──REST/WS──> Hub Server              # 仅 Hub
Mobile (RN)     ──REST/WS──> Hub Server              # 仅 Hub
Hub Server      ──HTTP─────> Edge Server             # 远程执行/中继
Hub Server      ──OIDC─────> TokenDance ID           # 认证
Edge Server     ──OS proc──> Agent Runtimes           # CLI 进程
```

## 关键数据流

### OIDC 登录
`浏览器 → TokenDance ID → Hub callback → Hub JWT 签发 → 设备注册 → Token 存储（keyring / sessionStorage / SecureStore）`

### Agent Run 生命周期
`用户消息 → Platform Adapter → Edge/Hub → Run 创建 → Runtime 进程 → 事件流 → Transcript 渲染 → 完成/持久化`

### IM 消息
`Composer → Hub REST → DB 持久化 → WS 广播 → 会话成员 → Agent 触发 → Run 生命周期 → 响应回传`

### Transcript 渲染管线
`Upstream → adapter.ts → TranscriptItem[] → Transcript 组件 → AgentGroup/UserMsg → RowItem（10 种卡片类型 × 4 种状态）`

## 配置面

所有配置通过 `AGENTHUB_*` 环境变量注入。`.env.example` 位于仓库根目录。关键配置项：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `AGENTHUB_JWT_SECRET` | dev 占位符 | JWT 签名密钥（最少 32 字符） |
| `AGENTHUB_DB_*` | localhost:5432 | PostgreSQL 连接参数 |
| `AGENTHUB_REDIS_*` | localhost:6379 | Redis 连接参数 |
| `AGENTHUB_TOKENDANCE_ID_*` | 生产占位符 | OIDC issuer / client / secret |
| `AGENTHUB_ADDR` | 127.0.0.1:3210 | Edge 监听地址 |
| `AGENTHUB_EDGE_AUTH_TOKEN` | (空) | Edge-to-Hub 共享密钥 |

## 当前状态

- **Super 评分**：63/100（治理审计后）
- **8 个未关闭高危风险**阻断发布
- **分支**：当前在 `master`，`dev/delicious233` 落后 15 个提交
- **Go 测试**：全部通过（hub-server 14 packages、edge-server 14 packages）
- **TypeScript typecheck**：Desktop/Web 通过、Mobile 失败（exactOptionalPropertyTypes × 3 errors）
- **前端测试**：Desktop 144/150、Web 18/21（9 个文件因 ESM import 失败）
