# Changelog

## [0.3.0-rc.7] — 2026-06-09

### 发布定位
- 统一收口 `dev/release-0.3.0-rc7` 集成线，基线来自 `origin/master` 的 PR #297 合并提交 `b7e9c1a4`。
- 本候选版本面向 Windows Desktop 与 Android 本地 release APK 证据，不声明生产签名、商店发布或真实模型消耗完成。
- `master` 合入、tag、GitHub Release upload 已完成；Windows 签名、公证和 updater metadata 仍需要独立发布窗口。

### Mobile
- 合入 Expo / React Native 主线 `app/mobile-rn` 的 native capability settings，可在账号和工作台入口展示媒体、存储、通知、SecureStore、deep link 等 readiness 状态。
- 统一 Mobile 底部导航、分段控件、账号页和工作台页的 motion/press feedback。
- 新增 `useNativeCapabilities` 测试，锁定 Mobile native readiness 的 no-secret 合同。
- 新增 `app/mobile-rn/scripts/package-android.ps1` 和 `pnpm android:package`，在 Windows 上通过 `D:\ah\a` 短路径 junction 与 `D:\p\a` pnpm virtual store 构建 `assembleRelease` APK，规避 Expo/RN/Gradle root mismatch 与 `expo-modules-core` CMake/ninja 长路径失败。
- Android adaptive icon 改为透明安全区 foreground，避免桌面图标被系统 mask 裁切；启动器短名改为 `AgentHub`。
- 本地 Android release APK 已安装到 Wi-Fi ADB 设备 `192.168.1.105:5555` 并成功打开内置 demo，不再依赖 Metro。

### Desktop / Web / Hub / Edge
- 保留 Web -> Hub -> Desktop/Edge -> CLI/SDK adapter -> replay 的 P0 主链为本轮最高优先级。
- 当前可复验范围仍以 fixture、observed、no-spend 和 approved-real readiness 为主。
- 真实 TokenDanceID 登录、真实 CLI/model/API 调用、远程控制真实 Desktop CLI 仍需额外 approved-real 证据。

### Release Gate
- 修复 `verify-p0-approved-real-gold-path.ps1` 在 Windows PowerShell 5.1 下依赖 `ProcessStartInfo.ArgumentList` 的兼容性问题。
- 修复 approved-real readiness manifest 中 `$Output` 为空时的 `output_excerpt` 处理。
- `tests\scripts\verify-p0-approved-real-gold-path.ps1 -RepoRoot .`、`tests\scripts\verify-approved-real-demo-readiness.ps1 -RepoRoot .`、`app/mobile-rn` 的 `pnpm verify`、`pnpm native:check` 和 `pnpm mock:hub:check` 已通过。
- Windows unsigned dry package 已产出 `AgentHub_0.3.0-rc.7_x64-setup.exe`、`AgentHub_0.3.0-rc.7_x64-portable.zip`、Desktop exe 与 Edge sidecar，并记录 SHA-256 manifest。
- Android 本地 release APK 已产出 `AgentHub-Mobile_0.3.0-rc.7_android-release.apk`，SHA-256: `F11E4C3B970C0C08B63ADD6BC37B8A5B4B7767EE5705D64D8176A59C23E5AD4C`。

### 已知阻塞
- TokenDanceID 真实登录链路仍缺 approved test account/client 环境证据。
- Android release signing、Play/App Store 分发、iOS simulator/EAS 路线仍未完成；当前 Android APK 是本地 debug-signing release APK。
- Windows 签名安装包、macOS 签名/公证和 updater metadata 不在默认自动执行范围内。
- 开放的 Critical/High 安全风险必须关闭或明确 accepted risk 后才能发布 stable。

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

## [0.4.0] — 2026-06-04

### Changed
- 文档去重：删除旧 ADR 目录（`adr/` → `decisions/` 完整超集）；去重 `governance-execution.md`、`security-risk-register.md`；`handover.md` 移入 `handoff/`
- 安全风险登记：根目录精简版与 governance/ 详细版合并为单一 272 行权威版本（44 项 AH-SR 发现）
- 历史执行计划（wave1、worktree）和 fix-note 归档至 `archive/`
- `.gitignore` 修复无效 pattern + 消除冗余 + 分组重构为 14 个清晰分组
- AGENTS.md / CONTRIBUTING.md / README 交叉引用修复
- 27 处断裂文档引用修复

### Removed
- 删除冗余 `docs/operations/client-roadmap.md`（纯指针文件）
- 删除过时远程分支 `feat/team-johnny-merge`、`dependabot/*`

### Fixed
- 本地构建产物清理（edge-server/hub-server exe/cov/coverage，约 250MB+）
- `.tmp/` 400+ 调试截图清除
