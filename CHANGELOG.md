# Changelog

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
- 78 database migrations (PostgreSQL + Redis)

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
