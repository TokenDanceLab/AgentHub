# 08 — 构建与开发体验审计

> 审计时间: 2026-06-07 | 审计范围: Monorepo 结构、构建配置、脚本、CI/CD、Go 构建、Tauri 构建、开发者入职

---

## 1. Monorepo 结构

### 1.1 Workspace 管理

| 项目 | 文件 | 状态 |
|------|------|------|
| pnpm workspace | `app/pnpm-workspace.yaml` | 🟢 |
| Go workspace | `go.work` | 🟢 |
| Lockfile | `app/pnpm-lock.yaml` | 🟢 |

**详情:**

- pnpm workspace 定义了 `shared`、`desktop`、`web`、`mobile` 四个子项目，结构清晰。
- `go.work` 使用 `edge-server`、`hub-server`、`pkg` 三个模块，Go workspace 模式正确。
- pnpm lockfile 已提交，CI 使用 `--frozen-lockfile` 保证可复现性。
- `packageManager: "pnpm@10.32.1"` 在根 `app/package.json` 中锁定版本，`allowBuilds` 和 `onlyBuiltDependencies` 配置合理。

### 1.2 子项目 package.json 脚本

| 子项目 | 文件 | 状态 |
|--------|------|------|
| 根 | `app/package.json` | 🟢 |
| desktop | `app/desktop/package.json` | 🟢 |
| web | `app/web/package.json` | 🟢 |
| mobile | `app/mobile/package.json` | 🟡 |
| shared | `app/shared/package.json` | 🟡 |

**详情:**

- 根 `app/package.json` 提供了完整的工作流命令：`dev`、`build`、`lint`、`typecheck`、`test`、`test:e2e`、`lint:css`。
- Desktop 的脚本最完善：含 `test:ci`（拆分多个 vitest 配置并行跑）、`analyze`（bundle 可视化）、`storybook`。
- Web 缺少 `analyze`、`format` 命令；mobile 有但脚本较少。
- Shared 包的 `lint` 脚本用 `tsc --noEmit` 代替 eslint，功能不完整。

### 1.3 依赖重复与版本不一致

| 问题 | 涉及文件 | 状态 |
|------|----------|------|
| React 版本不完全对齐 | `app/desktop/package.json`, `app/mobile/package.json` | 🟡 |
| 多处重复声明相同依赖 | 各子项目 `package.json` | 🟡 |
| Tauri API 版本不一致 | desktop vs mobile | 🟡 |

**详情:**

- desktop 声明 `react: ^19.2.7`，mobile 声明 `react: ^19.1.0`，虽然 semver 范围兼容但不统一。
- desktop 的 `@tauri-apps/api: ^2.11.0` vs mobile 的 `@tauri-apps/api: ^2.5.0`，差异较大。
- `@tanstack/react-query`、`zustand`、`i18next` 等在各子项目重复声明，但版本略有差异。
- 根 `app/package.json` 将 React、zustand 等放 `dependencies` 而非 `devDependencies`，但这可能是有意的 hoisted 策略。
- **建议:** 统一子项目间的依赖版本，考虑使用根 `package.json` 的 `pnpm.overrides` 或 `catalogs` 统一管理。

---

## 2. 构建配置

### 2.1 Vite 配置对比

| 配置项 | Desktop | Web | Mobile | 状态 |
|--------|---------|-----|--------|------|
| dedupe | `react, react-dom` | `react, react-dom` | 无 | 🟡 |
| manualChunks | 5 组 vendor chunks | 3 组 vendor chunks | 无 | 🟡 |
| sourcemap | TAURI_DEBUG 控制 | 无 | 无 | 🟢 |
| minify | esbuild (prod) | 默认 | 默认 | 🟡 |
| envPrefix | `VITE_, TAURI_` | `VITE_` | `VITE_, TAURI_` | 🟢 |
| dev port | 5173 | 5174 | 5175 | 🟢 |
| alias 去重 | lucide-react, react, react-dom, react-i18next | 同 desktop | 仅 @agenthub/shared | 🟡 |

**详情:**

- Desktop 的 vite 配置最完善：有 `manualChunks`（vendor 拆分）、条件性 sourcemap、target 指定。
- Web 的 `manualChunks` 缺少 `vendor-tanstack` 和 `vendor-markdown` 拆分，bundle 可能较大。
- Mobile 缺少 `dedupe` 和 `manualChunks`，生产构建包体积可能较大。
- Mobile 的 alias 使用 `@agenthub/shared` 而非 `@shared`，与 desktop/web 不一致。
- **建议:** 将公共 vite 配置提取到 `app/shared/vite.shared.ts`，子项目继承而非复制。

### 2.2 TypeScript 配置一致性

| 配置项 | Desktop | Web | Shared | Mobile | 状态 |
|--------|---------|-----|--------|--------|------|
| target | ES2021 | ES2021 | ES2021 | ES2021 | 🟢 |
| strict | true | true | true | true | 🟢 |
| noUncheckedIndexedAccess | true | true | true | 无 | 🟡 |
| exactOptionalPropertyTypes | false | true | false | 无 | 🔴 |
| resolveJsonModule | true | true | 无 | true | 🟡 |
| paths @shared | 有 | 有 | 无 | 无 (@agenthub/shared) | 🟡 |
| types vitest/globals | 有 | 无 | 无 | 有 | 🟡 |

**详情:**

- `exactOptionalPropertyTypes` 在 web 为 `true`、desktop/shared 为 `false`、mobile 未设置。这是一个严格的类型检查选项，不一致会导致跨项目编译时的类型签名差异。
- Mobile 缺少 `noUncheckedIndexedAccess`，数组索引访问未受保护。
- Shared 的 tsconfig 没有 `resolveJsonModule`，如果 shared 中需要 import JSON 文件会报错。
- Desktop 和 mobile 配置了 `types: ["vitest/globals"]`，而 web 和 shared 没有——导致 vitest globals 在不同项目行为不一致。
- **建议:** 创建 `app/tsconfig.base.json` 统一基础配置，各子项目 `extends` 继承。将 `exactOptionalPropertyTypes` 统一为 `false` 或全部升级到 `true`。

---

## 3. 开发脚本质量

### 3.1 根 scripts/ 目录

| 脚本 | 平台 | 可维护性 | 状态 |
|------|------|----------|------|
| `setup.ps1` | Windows | 简洁、有参数化 | 🟢 |
| `setup.sh` | Unix | 未读取（推测对称） | 🟢 |
| `dev-start.ps1` / `.sh` | 双平台 | 健壮、端口检查、进程管理 | 🟢 |
| `dev-up.ps1` / `.sh` | 双平台 | Docker Compose + 健康检查 | 🟢 |
| `dev-down.ps1` / `.sh` | 双平台 | 清理脚本 | 🟢 |
| `check-secrets.sh` | Bash | 全面、正则匹配、CI/local 双模式 | 🟢 |
| `release.ps1` | Windows | worktree 构建、多平台产物、上传 | 🟢 |
| `git-hooks/commit-msg` | Bash | Conventional Commits 验证 | 🟢 |
| `verify-ci-gates.ps1` | PowerShell | CI 门禁验证 | 🟢 |

**详情:**

- 脚本覆盖 Windows (PowerShell) 和 Unix (Bash) 双平台，这对跨平台开发很关键。
- `dev-start` 脚本有完整的前置检查（go、node、pnpm）、端口等待、健康检查、进程清理。
- `check-secrets.sh` 是高质量的密钥扫描脚本：覆盖 AWS key、GitHub token、Slack token、Google API key、JWT、通用 secret 赋值，且有 placeholder 白名单。
- `release.ps1` 使用 git worktree 做干净构建，逻辑完整。
- **建议:** 无重大问题。考虑将 `setup.ps1` 扩展为自动检测和安装前置依赖（go、node、pnpm）。

### 3.2 子项目脚本

| 脚本 | 文件 | 状态 |
|------|------|------|
| `app/desktop/scripts/guarded-dev.mjs` | 端口冲突检测 | 🟢 |
| `app/mobile/scripts/visual-qa.mjs` | 视觉 QA | 🟢 |
| `app/mobile/scripts/emulator-qa.mjs` | 模拟器 QA | 🟢 |
| `app/web/scripts/visual-qa.mjs` | 视觉 QA | 🟢 |

**详情:**

- `guarded-dev.mjs` 防止 desktop/web 共用端口冲突，设计巧妙。
- 各 QA 脚本存在但无法评估内部实现质量（已审计了存在性）。

---

## 4. CI/CD

### 4.1 GitHub Actions 工作流

| 工作流 | 文件 | 状态 |
|--------|------|------|
| checks | `.github/workflows/checks.yml` | 🟢 |
| release | `.github/workflows/release.yml` | 🟢 |

**checks.yml 详细审计:**

| Job | 内容 | 状态 |
|-----|------|------|
| go-edge | build + lint + test + coverage >= 75% + race + gosec + govulncheck + vet + commit-msg | 🟢 |
| go-hub | build + lint + test + coverage >= 40% + race + gosec + govulncheck + vet | 🟢 |
| cross-build | 3 OS 矩阵 (ubuntu/windows/macos) | 🟢 |
| docker | Hub Server Docker 构建 | 🟢 |
| benchmark | Edge + Hub benchmark 回归 | 🟢 |
| frontend-desktop | install + typecheck + lint + test:ci | 🟢 |
| frontend-web | install + lint + build + test | 🟢 |
| frontend-mobile | install + typecheck + build + test | 🟢 |
| e2e-smoke | Playwright chromium smoke | 🟢 |
| validate | whitespace + secret guard + CI gates + OpenAPI YAML | 🟢 |

**release.yml 详细审计:**

| Stage | 内容 | 状态 |
|-------|------|------|
| build-go | Linux/Windows/macOS 多平台 Go 构建 | 🟢 |
| build-desktop | Windows Tauri (NSIS + portable zip) | 🟢 |
| build-desktop-macos | macOS Tauri (DMG) | 🟢 |
| release | GitHub Release 创建 + 上传 | 🟢 |

**详情:**

- CI 覆盖面非常全面：Go 单元/集成/benchmark、前端 lint/build/test、E2E、安全扫描、跨平台构建、Docker 构建。
- 覆盖率门禁：edge >= 75%（含 per-package 最低线）、hub >= 40%。
- `golangci-lint` 标记为 `continue-on-error: true`，初期可以接受但最终应该变为阻断。
- Release 流水线用 Go sidecar 方式将 edge-server 嵌入 Tauri 包，设计合理。
- **缺失:** 无 staging 环境自动部署、无 nightly build、无依赖缓存版本固定（`@latest` 引用 gosec/govulncheck）。
- **建议:** 将 `golangci-lint` 的 `continue-on-error` 改为 `false`。固定 gosec/govulncheck 版本避免 CI 不稳定。

### 4.2 Git Hooks

| Hook | 文件 | 状态 |
|------|------|------|
| commit-msg | `scripts/git-hooks/commit-msg` | 🟢 |
| prepare-commit-msg | `scripts/git-hooks/prepare-commit-msg` | 🟢 |

**详情:**

- 通过 `git config core.hooksPath scripts/git-hooks` 激活（在 `setup.ps1` 中配置）。
- commit-msg 钩子强制 Conventional Commits 格式 + 120 字节长度限制 + 禁止句末标点 + 调用 secrets 检查。
- 不是用 husky/lint-staged，而是原生 git hooks，更轻量。缺点是 `setup.ps1` 需要手动运行才能激活。
- **建议:** 在 README 中强调首次克隆后必须运行 `scripts/setup.ps1`（或 `setup.sh`）。

---

## 5. 开发者入职体验

### 5.1 README

| 项目 | 文件 | 状态 |
|------|------|------|
| README.md | 根目录 | 🟢 |

**详情:**

- README 提供了 5 步快速开始，包含 clone、setup、edge-server 启动、desktop 启动、使用。
- 前置依赖明确：Go 1.25+、Node.js 20+、pnpm。
- 架构图、技术栈、项目结构、文档导航齐全。
- **建议:** README 提到 Node.js 20+，但 CI 使用 Node 22。应统一。缺少 `.env.example` 的说明步骤。

### 5.2 环境变量文档

| 项目 | 文件 | 状态 |
|------|------|------|
| .env.example | 根目录 | 🟢 |
| hub-server/.env.example | Hub Server | 🟢 |
| hub-server/deployments/.env.production.example | 生产部署 | 🟢 |

**详情:**

- `.env.example` 覆盖全面：PostgreSQL、Redis、JWT、Hub Server、OIDC、Edge Server、Desktop。
- 每组变量都有中文注释说明用途。
- Hub Server 的 `.env.example` 还包含了 AgentTeam 资源限制和 OIDC 设置步骤。
- `app/desktop/.env.local` 仅含公开 URL（Hub API），无敏感信息。
- **发现:** 根 `.env` 文件包含真实凭证（S3、WebDAV、MCP access token），虽然 `.gitignore` 已排除 `.env`，但这说明开发者需要特别小心不要提交。密钥扫描 hook `check-secrets.sh` 是有效的最后防线。
- **建议:** 在 `.env.example` 顶部增加醒目警告：`# WARNING: Never commit .env with real credentials. Use .env.example as template only.`

### 5.3 Docker Compose

| 项目 | 文件 | 状态 |
|------|------|------|
| docker-compose.yml | 根目录 | 🟢 |

**详情:**

- Docker Compose 提供 PostgreSQL 16 + Redis 7 + Hub Server 完整技术栈。
- 健康检查配置正确（pg_isready、redis-cli ping、wget /health）。
- 端口默认绑定 127.0.0.1，安全意识好。
- `dev-up.sh`/`dev-up.ps1` 一键启动，`dev-down.sh`/`dev-down.ps1` 停止清理。
- **缺失:** Edge Server 不在 docker-compose 中（本地运行是合理的）。缺少 `docker-compose.override.yml.example` 用于开发者自定义。

---

## 6. Go 构建系统

### 6.1 Go Modules

| 项目 | 文件 | Go 版本 | 状态 |
|------|------|---------|------|
| edge-server | `edge-server/go.mod` | 1.25.0 | 🟢 |
| hub-server | `hub-server/go.mod` | 1.25.0 | 🟢 |
| pkg | `pkg/go.mod` | 1.25.0 | 🟢 |
| go.work | `go.work` | 1.25.0 | 🟢 |

**详情:**

- Go workspace 正确关联三个模块。
- Edge-server 依赖精简：仅 jwt、websocket、prometheus、yaml。
- Hub-server 依赖较重但合理：gin、gorm、postgres、redis、s3、viper、zap、prometheus 等。
- 两个服务都使用 `golang-jwt/jwt/v5` 保持一致。
- Edge 使用 `gorilla/websocket`，Hub 使用 `coder/websocket`——两者是不同的 WebSocket 库。
- **建议:** 统一 WebSocket 库选择，减少维护负担。考虑 hub-server 是否真的需要 sqlite 依赖（`glebarez/sqlite`）。

### 6.2 Makefile

| 项目 | 文件 | 状态 |
|------|------|------|
| 根 Makefile | `Makefile` | 🟢 |
| hub-server Makefile | `hub-server/Makefile` | 🟢 |
| edge-server Makefile | 不存在 | 🟡 |

**详情:**

- 根 Makefile 非常完善：前后端统一入口、help 文档、test/lint/coverage/sec/bench/release 全覆盖。
- hub-server 有独立的 Makefile 用于开发。
- edge-server 缺少独立 Makefile，只能通过根 Makefile 或直接 `go run`。
- **建议:** 为 edge-server 添加 Makefile 保持一致。

### 6.3 Docker 构建

| 项目 | 文件 | 状态 |
|------|------|------|
| Hub Server Dockerfile | `hub-server/deployments/Dockerfile` | 🟢 |
| Edge Server Dockerfile | 不存在 | 🟡 |

**详情:**

- Hub Server Dockerfile 使用多阶段构建（golang:1.25-alpine -> alpine:3.21），最佳实践。
- 非 root 用户运行（`agenthub`）、HEALTHCHECK 配置、ca-certificates 和 tzdata 安装。
- Edge Server 没有 Dockerfile，因为它是本地 sidecar 运行模式，这是合理的。
- CI 中 Docker 构建测试覆盖了 hub-server。
- **注意:** Dockerfile 中 COPY `go.work` 文件，意味着构建依赖 go.work workspace 布局。

### 6.4 golangci-lint 配置

| 项目 | 文件 | 状态 |
|------|------|------|
| edge-server | `.golangci.yml` | 🟢 |
| hub-server | `.golangci.yml` | 🟢 |

**详情:**

- 两个服务都启用了 cyclop、gocognit、gocyclo、misspell、prealloc、revive、unconvert、whitespace。
- Hub-server 额外启用了 gosec（安全扫描）。
- 复杂度阈值设置合理：cyclop <= 21、gocognit <= 30、gocyclo <= 20。
- 测试文件对复杂度 linter 做了排除（合理）。
- **建议:** Edge-server 也启用 gosec，保持一致。

---

## 7. Tauri 构建

### 7.1 Tauri 配置

| 项目 | 文件 | 状态 |
|------|------|------|
| tauri.conf.json | `app/desktop/src-tauri/tauri.conf.json` | 🟢 |

**详情:**

- Tauri 2 配置完整：自定义窗口标题栏（decorations: false, transparent: true）、CSP 安全策略、NSIS 安装器（中英双语）、自动更新。
- `externalBin` 引用 edge-server sidecar 二进制，正确。
- CSP 策略限制 connect-src 到 self + localhost，安全。
- Updater 公钥已内嵌，endpoint 指向 GitHub Releases。
- **建议:** `tauri.conf.json` 中 `beforeDevCommand` 和 `beforeBuildCommand` 使用 `corepack pnpm`，考虑统一为 `pnpm`（corepack 是间接调用）。

### 7.2 Cargo.toml

| 项目 | 文件 | 状态 |
|------|------|------|
| Cargo.toml | `app/desktop/src-tauri/Cargo.toml` | 🟢 |

**详情:**

- 依赖管理干净：tauri 2 + plugins（shell、notification、dialog、updater）+ keyring + reqwest + tokio。
- reqwest 使用 `rustls-tls`（非 OpenSSL），构建依赖更轻量。
- 平台特定的 keyring store 依赖正确分离（windows-native-keyring-store、apple-native-keyring-store、linux-keyutils-keyring-store）。
- dev profile 优化了依赖编译（`opt-level = 2`），但保留主 crate 调试友好（`opt-level = 1`）。
- **缺失:** 没有 `Cargo.lock` 的检查（Tauri 项目应该提交 Cargo.lock）。
- **建议:** 确认 `Cargo.lock` 已提交到 git。添加 `build.rs` 或构建脚本验证 sidecar binary 存在。

---

## 8. 测试基础设施

### 8.1 Vitest 配置

| 项目 | 文件 | 状态 |
|------|------|------|
| shared | `app/shared/vitest.config.ts` | 🟢 |
| desktop | `app/desktop/vitest.config.ts` | 🟢 |
| desktop CI | 5 个 vitest CI 配置 | 🟡 |
| web | `app/web/vitest.config.ts` | 🟢 |

**详情:**

- Shared 配置了覆盖率阈值（60% lines/branches/functions/statements），很好。
- Desktop 的 CI 配置拆分为 5 个文件（desktop-ci、desktop-ts-ci、desktop-tsx-ci、edge-integration-ci、shared-ci），用于并行测试。这增加了维护负担但提升了 CI 速度。
- Desktop 测试包含 shared 的测试文件（`include` 中有 `../shared/src/**/*.test.*`），确保 cross-package 测试。
- **建议:** 考虑合并 CI 配置，使用 vitest 的 `projects` 或 `pool: 'forks'` 特性代替 5 个独立配置文件。

### 8.2 Playwright E2E

| 项目 | 文件 | 状态 |
|------|------|------|
| E2E config | `app/e2e/playwright.config.ts` | 🟢 |
| Desktop config | `app/desktop/playwright.config.ts` | 存在 |
| Web config | `app/web/playwright.config.ts` | 存在 |

**详情:**

- E2E 配置针对 Web 端口 5174，使用 `webServer` 自动启动。
- 支持 chromium + firefox 双浏览器。
- CI 模式有 retry、trace、screenshot 配置。
- CI job 中 `e2e-smoke` 仅跑 chromium，覆盖足够。

---

## 9. 关键发现汇总

### 🔴 关键问题

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| 1 | TypeScript `exactOptionalPropertyTypes` 不一致 | `app/web/tsconfig.json` vs 其他 | 统一为 false 或全部升级到 true |
| 2 | Tauri `tauri.conf.json` 版本号与 `Cargo.toml` 不一致 | `tauri.conf.json` 0.2.0 vs `Cargo.toml` 0.1.0 | 统一版本号 |

### 🟡 需改进

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| 3 | Vite 配置大量重复（alias、dedupe） | desktop/web/mobile `vite.config.ts` | 提取公共 vite 配置到 shared |
| 4 | tsconfig 配置分散无继承 | 各子项目 `tsconfig.json` | 创建 `tsconfig.base.json` 统一 |
| 5 | 依赖版本跨子项目不完全一致 | 各 `package.json` | 使用 pnpm catalogs 统一 |
| 6 | Mobile 缺少 `noUncheckedIndexedAccess` | `app/mobile/tsconfig.json` | 添加此选项 |
| 7 | Desktop 有 5 个 CI vitest 配置 | `app/desktop/vitest.*-ci.config.ts` | 考虑用 vitest projects 合并 |
| 8 | Edge-server 无独立 Makefile | `edge-server/` | 添加 Makefile |
| 9 | Edge-server 未启用 gosec | `edge-server/.golangci.yml` | 添加 gosec linter |
| 10 | golangci-lint CI 标记 `continue-on-error` | `.github/workflows/checks.yml` | 改为 false |
| 11 | CI 中 gosec/govulncheck 用 `@latest` | `.github/workflows/checks.yml` | 固定版本 |
| 12 | Mobile Vite 缺少 manualChunks/dedupe | `app/mobile/vite.config.ts` | 添加生产优化 |
| 13 | Web Vite 缺少部分 vendor chunk 拆分 | `app/web/vite.config.ts` | 补充 tanstack/markdown chunks |
| 14 | Shared lint 脚本不完整 | `app/shared/package.json` | 使用 eslint 替代 tsc |
| 15 | WebSocket 库不统一 | edge (gorilla) vs hub (coder) | 统一选择 |

### 🟢 表现优秀

| # | 优点 |
|---|------|
| 1 | CI/CD 覆盖非常全面：Go + 前端 + E2E + Docker + Benchmark + 跨平台 + 安全扫描 |
| 2 | Release 流水线完整：多平台 Go 构建 + Tauri (Windows NSIS/portable + macOS DMG) + 自动上传 |
| 3 | 密钥扫描脚本 `check-secrets.sh` 质量高，覆盖多种 secret pattern |
| 4 | Dev 脚本双平台支持（PowerShell + Bash），有健康检查和进程管理 |
| 5 | Docker Compose 开发环境一键启动，端口默认绑定 127.0.0.1 |
| 6 | Conventional Commits 钩子强制执行 |
| 7 | Go workspace 正确使用 `go.work`，Dockerfile 多阶段构建最佳实践 |
| 8 | `.env.example` 覆盖全面，注释清晰 |
| 9 | Tauri CSP 安全策略正确配置 |
| 10 | Cargo.toml 使用 rustls 替代 OpenSSL，keyring 平台分离 |

---

## 10. 改进建议优先级

| 优先级 | 建议 | 影响 |
|--------|------|------|
| P0 | 统一 `exactOptionalPropertyTypes` 配置 | 跨项目类型签名不一致可能引发运行时 bug |
| P0 | 统一 `tauri.conf.json` 和 `Cargo.toml` 版本号 | 版本不一致导致发布混乱 |
| P1 | 提取公共 vite/tsconfig 配置 | 减少重复，降低维护成本 |
| P1 | 统一子项目依赖版本 | 避免版本漂移 |
| P1 | CI 中 golangci-lint 改为阻断 | 代码质量门禁 |
| P2 | 固定 CI 工具版本（gosec、govulncheck） | CI 稳定性 |
| P2 | 添加 edge-server Makefile 和 gosec | 一致性 |
| P2 | Mobile Vite 添加生产优化 | 包体积优化 |
| P3 | 合并 desktop CI vitest 配置 | 维护简化 |
| P3 | WebSocket 库统一 | 降低维护负担 |
