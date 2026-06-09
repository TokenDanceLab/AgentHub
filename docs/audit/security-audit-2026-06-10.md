# AgentHub 安全审计报告

**日期**: 2026-06-10
**仓库**: D:\Code\TokenDance\AgentHub
**审计范围**: 密钥泄露、凭据硬编码、IP/主机名泄露、.gitignore 覆盖、依赖安全、Git 历史
**审计人**: Claude Code automated scan

---

## 审计摘要

| 严重级别 | 数量 |
|---------|------|
| Critical | 0 |
| High | 3 |
| Medium | 5 |
| Low | 4 |
| Info | 4 |

**整体安全态势**: 良好。仓库有完善的密钥防护机制（check-secrets.sh pre-commit hook、generate-secrets.sh 生产脚本、config.go hardcoded secret rejection），.gitignore 覆盖面全面，未发现真实 API key/token 泄露。主要风险集中在开发配置中的默认凭据和测试 fixture 中的本地路径泄露。

---

## 发现详情

### HIGH-1: config.yaml 包含明文开发数据库密码

- **文件**: `hub-server/configs/config.yaml` (line 10), `hub-server/configs/config.docker.yaml` (line 10)
- **内容**: `password: dev_password`
- **风险**: 如果开发者直接使用这些配置文件部署到生产环境，数据库将使用弱密码 `dev_password`
- **缓解**: `config.go` 已实现 JWT secret hardcoded rejection，但 DB password 无类似校验
- **建议**: 在 config validation 中添加生产环境 DB password 强度检查（至少在生产模式下拒绝 `dev_password`）

### HIGH-2: .env.example 包含开发 JWT secret

- **文件**: `.env.example` (line 29), `hub-server/.env.example` (line 3)
- **内容**: `AGENTHUB_JWT_SECRET=dev-secret-change-in-production-min-length-32`
- **风险**: 新开发者可能忘记修改，使用示例值启动服务
- **缓解**: `config.go` 已有 known hardcoded secrets blocklist 包含 `dev-secret-change-in-production`，生产环境会拒绝
- **建议**: 已有充分缓解，但建议在 .env.example 中用 `<generate-with-openssl-rand-hex-32>` 替代实际字符串

### HIGH-3: 测试 fixture 声明 "actual-value-present" 作为 API key

- **文件**: `tests/scripts/approved-real-preflight.invalid-secret.json` (line 42)
- **内容**: `"OPENAI_API_KEY": "actual-value-present"`
- **风险**: 该文件设计为 negative test case（名称含 `.invalid-secret`），但 `actual-value-present` 这个字符串本身可能误导自动化扫描或审计工具。该 JSON 的 `redaction_policy` 明确要求 redact，说明团队有安全意识
- **缓解**: 文件名明确标识为 invalid，包含 `operator@example.invalid` 测试标识符
- **建议**: 将值改为 `<REDACTED-PLACEHOLDER>` 或 `test-value-never-real`，避免歧义

### MEDIUM-1: 测试代码中硬编码本地 Windows 路径 (C:\Users\Ding)

- **文件**: 多个 edge-server 测试文件
  - `edge-server/internal/store/store_contract_test.go:156` — `"C:/Users/Ding/private/secret.log"`
  - `edge-server/internal/lifecycle/process_executor_test.go:520` — `"C:\\Users\\Ding\\private"`
  - `edge-server/internal/lifecycle/process_executor_test.go:1707` — `"C:\\Users\\Ding\\private\\fixture.patch"`
  - `edge-server/internal/adapters/sdk_fixture_mapper_test.go:408,466,533,602,616,633,637` — 多处 `C:\Users\Ding\` 路径
- **风险**: 泄露开发者本地用户名和目录结构。虽然都是测试 fixture，但公开仓库中不应包含真实个人路径
- **建议**: 统一替换为 `C:\Users\testuser\` 或 `/home/testuser/` 等通用路径

### MEDIUM-2: 多处公开域名引用

- **文件**: 多个文件
  - `api/openapi.yaml:34` — `http://api.hub.vectorcontrol.tech`
  - `.env.example:49` — `https://id.vectorcontrol.tech`
  - `hub-server/configs/config.yaml:53` — `https://id.vectorcontrol.tech`
  - `edge-server/internal/api/handlers_test.go:173` — `https://api.vectorcontrol.tech/v1`
  - `app/web/src/__e2e__/oidc-login.spec.ts:15` — `https://api.hub.vectorcontrol.tech`
  - `hub-server/deployments/Caddyfile.prod` — `api.hub.vectorcontrol.tech`
- **风险**: 暴露生产域名拓扑，攻击者可利用进行侦察
- **缓解**: OIDC issuer URL 是公开端点，必然出现在代码中；Edge test 中的 `api.vectorcontrol.tech` 是 Gateway URL
- **建议**: 测试和 fixture 中使用 `api.example.com` 替代真实域名；OpenAPI spec 和 config 中的域名属于产品公开信息，可以接受

### MEDIUM-3: generate-secrets.sh 终端输出包含 secret 前缀

- **文件**: `hub-server/scripts/generate-secrets.sh:84-87`
- **内容**: 输出 secret 前 8 字符 (`${JWT_SECRET:0:8}...`)
- **风险**: 如果终端日志被记录或上传，部分 secret 信息可能泄露
- **建议**: 生产使用时移除或重定向到 /dev/null，或添加 `--quiet` 模式

### MEDIUM-4: git 历史中存在大量 stats.html 大文件

- **文件**: `app/desktop/stats.html`（多个版本，最大 5MB）
- **详情**: git 历史中包含至少 9 个 stats.html 版本（5048KB~1206KB），总计约 25MB
- **风险**: 增加 clone 体积，stats.html 可能包含构建元数据
- **缓解**: 当前 .gitignore 已排除 `app/desktop/stats.html`
- **建议**: 考虑 `git filter-branch` 或 BFG 清理历史中的 stats.html

### MEDIUM-5: Web E2E 测试中引用 app/web/screenshots/ 中的图片

- **文件**: `app/web/screenshots/agent-square.png` (466KB, tracked)
- **风险**: 仓库中跟踪了二进制图片文件
- **建议**: 确认是否需要跟踪；如果仅用于 E2E 测试，考虑放入 `.gitignore` 并用 CI artifact 管理

### LOW-1: docker-compose.yml 默认密码 fallback

- **文件**: `docker-compose.yml` (line ~40)
- **内容**: `POSTGRES_PASSWORD: ${AGENTHUB_DB_PASSWORD:-dev_password}`
- **风险**: 如果未设置环境变量，将使用 `dev_password`
- **缓解**: 生产环境使用 `docker-compose.prod.yml`，其中使用 `${AGENTHUB_DB_PASSWORD:?必须设置}` 强制要求设置
- **建议**: 已有良好缓解，无额外行动

### LOW-2: docker-compose.prod.yml Redis healthcheck 传递明文密码参数

- **文件**: `hub-server/deployments/docker-compose.prod.yml`
- **内容**: `redis-cli -a "${AGENTHUB_REDIS_PASSWORD}" ping`
- **风险**: 进程列表中可能短暂暴露 Redis 密码
- **建议**: 改用 `REDISCLI_AUTH` 环境变量方式传递密码

### LOW-3: OIDC smoke test 引用真实 TokenDance ID endpoint

- **文件**: `hub-server/tests/oidc/oidc_smoke_test.go:111`
- **内容**: `authorizeURL: "https://id.vectorcontrol.tech/oidc/authorize"`
- **风险**: 测试可能意外向生产 OIDC 服务发起请求
- **建议**: 使用环境变量或测试配置覆盖

### LOW-4: app/mobile-rn/app.config.ts 中 Android emulator IP

- **文件**: `app/mobile-rn/app.config.ts:12`
- **内容**: `http://10.0.2.2:8088` (Android emulator special IP)
- **风险**: 极低 — 这是 Android emulator 的标准 loopback 地址
- **建议**: 无需修改，属于平台约定

### INFO-1: 无 pre-commit hook（仅有 commit-msg hook）

- **发现**: `scripts/git-hooks/` 中只有 `commit-msg` 和 `prepare-commit-msg`，没有 `pre-commit` hook
- **缓解**: `commit-msg` hook 末尾调用了 `scripts/check-secrets.sh --staged`，secret 检查已集成
- **建议**: 考虑添加 `pre-commit` hook 做 `git diff --check`（冲突标记检测）等额外检查

### INFO-2: GitHub Actions 无 secrets 使用

- **发现**: `.github/workflows/checks.yml` 不使用任何 `${{ secrets.* }}`
- **评估**: 正确 — CI 只做 build/lint/test，不需要凭据

### INFO-3: 仓库实现了完善的密钥防护体系

- `scripts/check-secrets.sh` — pre-commit 密钥扫描，支持 staged/worktree/range 模式
- `hub-server/internal/config/config.go` — 生产环境拒绝 hardcoded JWT secrets
- `hub-server/scripts/generate-secrets.sh` — 自动生成强随机生产密钥
- `pkg/debug/debug.go` — `SanitizeConfig()` 自动 redact 敏感配置字段
- `.gitignore` — 全面的 .env、证书、密钥、数据库文件排除规则

### INFO-4: 安全加固措施已到位

- WebSocket: 生产环境关闭 `InsecureSkipVerify`，仅开发模式允许
- CORS: 环境感知，生产模式有严格验证
- Rate limiting: Hub 全局 + Edge 级别均已实现
- 生产 Docker: 端口不对外暴露，使用 `:?` 强制要求密码设置
- Caddy: 完整安全响应头（HSTS、X-Frame-Options、CSP 等）

---

## .gitignore 评估

### 已覆盖（良好）

| 类别 | 模式 |
|------|------|
| 环境变量 | `.env`, `.env.local`, `.env.*`, `!.env.example` |
| 证书/密钥 | `*.pem`, `*.key`, `*.crt`, `*.cer`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*` |
| 数据库 | `*.db`, `*.sqlite`, `*.sqlite3`, `*.dump`, `*.bak`, `*.sql.gz` |
| 日志 | `*.log`, `npm-debug.log*` |
| 部署 | `hub-server/deployments/.env.production`, `hub-server/deployments/backups/` |
| Agent 状态 | `.claude/`, `.codex/*`, `.worktrees/` |
| 构建 | `dist/`, `build/`, `target/`, `node_modules/` |

### 覆盖充分，无缺失项

---

## 依赖安全

### Go 依赖 (hub-server)

- `golang.org/x/crypto v0.52.0` — bcrypt 密码哈希
- `golang-jwt/jwt/v5 v5.3.1` — JWT 签发和验证
- `gin-gonic/gin v1.12.0` — HTTP 框架
- 所有依赖版本较新，无已知严重漏洞

### Go 依赖 (edge-server)

- `golang-jwt/jwt/v5 v5.3.1` — JWT
- `modernc.org/sqlite v1.52.0` — 纯 Go SQLite
- 依赖链精简，攻击面小

### 前端依赖

- 未运行 `pnpm audit`（需要安装依赖），建议在 CI 中定期执行

---

## 生产部署前建议行动

### 必须完成（部署阻断项）

1. **确认所有 .env.production 值为强随机值** — 使用 `generate-secrets.sh` 生成
2. **确认 `AGENTHUB_JWT_SECRET` 环境变量已设置** — config.go 会拒绝默认值
3. **确认生产 Docker 端口不暴露** — 已在 docker-compose.prod.yml 中实现

### 建议完成（非阻断）

1. 替换测试 fixture 中的真实本地路径 (`C:\Users\Ding\`) 为通用路径
2. 将 `.env.example` 中的 JWT secret 示例值改为 `<generate-with-openssl-rand-hex-32>` 占位符
3. 测试文件中的 `api.vectorcontrol.tech` 替换为 `api.example.com`
4. 清理 git 历史中的 stats.html 大文件
5. Redis healthcheck 改用 `REDISCLI_AUTH` 环境变量
6. `tests/scripts/approved-real-preflight.invalid-secret.json` 中的 `actual-value-present` 改为明确的测试占位符

---

## 结论

AgentHub 仓库的安全基础设施整体成熟度高。核心防护层（密钥扫描 hook、配置验证、gitignore 覆盖、生产部署隔离）均已到位且实现质量高。未发现真实凭据泄露或 Critical 级别问题。

主要改进空间集中在测试代码中的本地路径和域名 hygiene，这些不影响运行时安全但会在公开仓库中泄露开发环境信息。
