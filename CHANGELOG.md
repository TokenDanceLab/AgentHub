# Changelog

## [0.4.0] — 2026-06-11

### 发布定位
- 统一收口 `dev/delicious233` 全链路，包括 v0.4.0-rc1 验证修复，基于 42+ 次提交的稳定基线。
- 本版本面向比赛提交功能验收，不声明生产签名、商店发布或真实模型消耗完成。

### v0.4.0-rc1 → v0.4.0 修复
- **CC Session 管理**：每次 run 创建全新 Claude Code session（`--session-id`），避免 session 复用导致的状态污染
- **Desktop 版本号**：bump to v0.4.0，产品名统一为 "AgentHub Desktop"
- **移除已提交二进制**：清理误提交的编译产物
- **README 重写**：对外展示风格，去除内部信息；添加产品截图 + Tauri badge
- **OIDC 真实用户接入**：Web + Hub + Edge 全链路接入真实用户信息，清理 mock 数据，默认工作目录改为 HOME
- **Desktop 本地 Edge 集成**：Claude Code CLI 从 Desktop 直接启动
- **Workbench 数据模式简化**：移除交互式下拉框，UI 更干净
- **AgentsPage 右侧面板宽度自适应修复**
- **Web demo conversations**：Hub 无活跃 session 时回退展示 demo
- **截图定位统一**：移至 docs/images/
- **文档引用同步**：agenthub-design → tokendance-design

### 红线合入（v0.3.0-rc.9 → v0.4.0-rc1）
- `dev/delicious233` → `origin/master` fast-forward（95afab54）
- 42+ 次提交覆盖 IM 全链路 10/10 chat actions、Desktop 认证令牌管道、Edge CLI 适配器真实执行、SDK HTTP 适配器 E2E 验证、Mobile hubClient 30+ 方法对齐、右侧面板 14 项增强、i18n zh/en 各 2169 键
- OIDC Full PKCE Flow 验证通过
- Android APK 首次本地构建成功（arm64-v8a，Release）
- E2E Smoke ALL 13 PHASES PASSED

### 已知阻塞
- 签名证书（生产发布阻断项）
- Codex `OPENAI_API_KEY` 缺失
- WS library compatibility with Hub upgrade response

## [0.4.0-rc1] — 2026-06-11

### 发布定位
- v0.4.0 release candidate 1，基线 `origin/master = 6a49fbe7`。
- 在 v0.3.0-rc.9 之上累积 CC session 修复、Desktop 本地 Edge 集成、OIDC 真实用户接入。

### 主要内容
- **CC Session 修复**：初次 session 管理方案落地（`--session-id`）
- **Desktop 本地 Edge + CC CLI**：直接集成 Claude Code CLI
- **OIDC 真实用户接入**：清理 mock 数据，HOME 默认工作目录
- **移除已提交二进制**：清理误提交的编译产物
- **README 重写**：对外展示风格 + 产品截图 + Tauri badge

## [0.3.0-rc.9] — 2026-06-10

### 发布定位
- `dev/delicious233` 最终收口，v0.3.0 全部功能冻结。
- 标记点：HEAD 750e27cc，origin/master 同步至此基线。

### 主要内容
- **IM 聊天全链路 10/10 chat actions**（Web + Desktop）
- **Desktop 认证令牌管道**：hubQueries/sessionQueries/documentQueries/projectQueries 全部认证
- **Hub Server 数据层完善**：Document CRUD、user_settings 迁移修复、Prometheus 空指针修复
- **Edge CLI 适配器**：Claude Code / OpenCode 真实 CLI 执行验证通过
- **SDK HTTP 适配器**：AnthropicSDKAdapter + OpenAISDKAdapter，SSE streaming，E2E verified
- **Mobile hubClient 30+ 方法**：platform adapter + 3 数据模式
- **右侧面板 14 项增强**：全部完成
- **Skill Market (8) + MCP Market (6)**：seed 数据 + UI
- **cc-switch Edge 集成**：模型别名路由 + AgentMemory 管道
- **E2E Smoke**：ALL 13 PHASES PASSED (95+/96)
- **OIDC Full PKCE Flow**：验证通过
- **Android APK**：首次本地构建成功

### 已知阻塞
- 签名证书、Codex OPENAI_API_KEY、WS lib compatibility

## [0.3.0-rc.8] — 2026-06-10

### 发布定位
- `origin/master` fast-forward 至 `95afab54`，42 次提交覆盖 Wave 0+1+2。
- 面向比赛提交功能验收。

### 主要内容
- IM 聊天全链路（Web + Desktop）10/10 chat actions
- Desktop 认证令牌管道
- Hub Server 50 个 migration，61 端点（49 返回 200）
- Edge CLI / SDK 适配器真实执行 + E2E 验证
- Mobile 30+ hubClient 方法 + 91 tests PASS
- 右侧面板 14 项增强全部完成
- Skill Market + MCP Market UI
- E2E Smoke ALL 13 PHASES PASSED
- OIDC Full PKCE Flow 验证通过

### 已知阻塞
- 签名证书、Codex OPENAI_API_KEY、WS lib compatibility

## [0.3.0-rc.7] — 2026-06-09

### 发布定位
- 统一收口 `dev/release-0.3.0-rc7` 集成线，基线 `origin/master = b7e9c1a4`（PR #297）。
- 面向 Windows Desktop 与 Android 本地 release APK 证据。

### Mobile
- 合入 Expo / React Native 主线 native capability settings
- 统一底部导航、分段控件 motion/press feedback
- `useNativeCapabilities` 测试锁定 no-secret 合同
- Android release APK 本地构建 + Wi-Fi ADB 部署
- Android adaptive icon 透明安全区 + 启动器短名 `AgentHub`

### Desktop / Web / Hub / Edge
- P0 主链保留：Web -> Hub -> Desktop/Edge -> CLI/SDK adapter -> replay
- fixture/observed/no-spend/approved-real readiness 为主

### Release Gate
- `verify-p0-approved-real-gold-path.ps1` Windows PowerShell 5.1 兼容修复
- `pnpm verify`、`pnpm native:check`、`pnpm mock:hub:check` 通过
- Windows unsigned dry package 产出

### 已知阻塞
- TokenDanceID 真实登录链路 approved test account 证据
- Android release signing、Play/App Store 分发、iOS EAS
- Windows 签名安装包、macOS 签名/公证
- Critical/High 安全风险

## [0.3.0] — 2026-06-03

### Added
- 生产级结构化日志（slog）——Hub Server、Edge Server、Desktop 三端统一
- 动态日志级别：`AGENTHUB_LOG_LEVEL` 环境变量
- OIDC 标准化 Authorization Code flow + 中英双语回调页面
- Edge 健康状态集成到 Desktop 设置面板
- Web AgentSquare 与 Workbench 独立页面内容
- 比赛提交准备文档——原子化任务清单 + 治理文档更新

### Changed
- Artifact 生命周期组件重构——shared/desktop/web 三端统一
- i18n 硬编码英文 toast 全部中文化（Desktop/Web useIMChat + Edge handlers）
- OIDC callback 流重构：改用 Hub 页面展示 code + waitForOIDCCallback
- Desktop Tauri OIDC 登录改用 shell.open() 替代 window.open()
- Edge 二进制发现和生命周期改进

### Fixed
- Windows 文件锁修复——Rename 前显式 Close 临时文件
- OIDC race condition + Edge-disconnected ChatView + Web 页面区分
- OIDC redirect_uri 修复 + HTTPS 升级 + loopback callback flow
- Hub CORS 中间件 log.Fatalf 替换为 slog.Error + os.Exit
- ChatView 滚动到底部按钮 + 聊天布局改进
- Docker DNS 从 127.0.0.11 改为公共解析器

### Engineering
- ChatView 16 个 regression 全绿 + Desktop 1165/1165 首次全通
- Web i18n 7→1 测试 failures 修复
- Hub 覆盖率 50.3%→51.2%（middleware + handler + service + model）
- Edge mock runner 从产品路径移除
- barrel 清理——13 个未使用组件移除导出
- WebLayout 1117→970 行拆分
- Web 移除死代码依赖 react-router-dom
- gitignore 补全 + 编译产物清理 + 本地临时目录条目

## [0.2.1-rc.1] — 2026-06-08

### 发布定位
- v0.2.0 补丁候选，来自隔离 worktree。
- 修复 CI/构建 pipeline 和生产部署配置。


## [0.2.0] — 2026-05-28

### Added
- 多预设主题引擎——亮色/暗色/玻璃态三套主题 + OKLCH CSS 变量补全
- 全局 select 替换为自定义玻璃态下拉组件
- Web 页面真实 API 集成——Workbench、AgentSquare、Chat、Group、Project
- shared 模块提取：workbenchState、workbenchDataMode、hubClient
- AgentTeam 竞品分析驱动的三阶段加速实现计划
- 竞品动态追踪报告——Teamily、Claude SDK、Codex、Cursor、Windsurf

### Changed
- SettingsPage 拆分——2734 行拆为按标签页分段组件
- Desktop 组件去重——3 个重复组件迁移到 @shared/ui
- IM 系统增强：好友请求、消息撤回、已读回执、群聊会话
- i18n 命名空间化：flat dot-notation keys
- Hub Server Docker Compose 开发环境（PostgreSQL 16 + Redis 7 + Hub Server）
- CSS 语义化——150+ 处硬编码颜色替换为 CSS 变量

### Fixed
- PWA 配置 + Tauri 配置 + shared/barrel + CSP 修复
- hub-server Redis 端口文档对齐（6380→6379）
- 跨平台 git hooks 兼容性修复
- CI 改进：pnpm 缓存 + node 版本一致性

### Engineering
- Makefile 新增 release 目标：`make release VER=v0.1.1` 一键发版
- .editorconfig 统一跨编辑器缩进和换行
- .dockerignore 排除测试/文档/本地文件
- git hooks 规范化：术语 runner→edge
- errcode 包覆盖率 40%→100%

## [0.1.0] — 2026-05-27

### Desktop Command Center (P0)
- Multi-runtime Agent CLI support (Claude Code, Codex, OpenCode)
- IM-native workspace with thread-based collaboration
- Side-by-side diff review panel with approval workflow
- Artifact preview and run output rendering
- Tauri 2 desktop shell with glassmorphism chat UI
- Operational Home dashboard, settings search, Tooltip
- Agent Profile configuration (Runtime, Model, Skill, MCP, approval policy)

### Hub Server (P1-P2)
- TokenDance ID unified login (OIDC PKCE exchange)
- Hub-local session management with access/refresh tokens
- IM contacts, group sessions, multi-device sync
- Agent dispatch bridge (Web -> Hub -> Desktop -> Edge)
- WebSocket typed events + REST JSON API (OpenAPI 3.0)
- AgentTeam models, API, and StartTeamRun orchestration
- Target-bound device routing and execution target inventory
- Team run events, conflict resolution, artifact indexing
- Approval controls queue with team decision recording
- Runtime event history, stream validation, offline task queue
- 50 database migrations (PostgreSQL + Redis)

### Edge Server
- Local execution node with Agent Runtime adapters (Claude Code, Codex, OpenCode)
- Process lifecycle management, EventStore, workspace allowlist
- Run cleanup, output budget caps, context auto-compaction engine
- SKILL.md discovery and injection into agent adapters
- AgentTree slot enforcement and mailbox trigger_turn
- Prometheus metrics and health checks
- Context budget tracking with per-child ratio enforcement

### Web App
- Browser workspace for remote viewing and approvals
- Hub typed RunEvent replay and projection
- Structured runtime message display
- Ecosystem console with Hub session authentication

### Mobile App
- Tauri 2 mobile shell with independent project configuration
- Mobile-native bubble chat, run review, approval workflow
- Bottom navigation, activity cards, context awareness
- i18n (zh/en)

### Engineering
- CI/CD: GitHub Actions (Go test/lint/race/vet, pnpm test/typecheck/build)
- Cross-platform build matrix (ubuntu, windows, macos)
- Edge >= 75% coverage, Hub >= 40% coverage (hard gate)
- golangci-lint v2, gosec, govulncheck
- Benchmark regression checks for events and adapters
- Docker build verification and Docker Compose production deployment
- Commit message format enforcement: type(scope): 中文摘要
- Secret guard, whitespace check, CI gate policy validation