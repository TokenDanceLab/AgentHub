# Changelog

已发布版本的 longform 记录（破坏性变更、升级注意、release gate 结论）在这里；commit 级的用户可见变更明细不手写，由 git-cliff 生成到 GitHub Release 正文（SSOT 声明见下方 Unreleased 节）。2026-06-27 前的完整历史 changelog 见 [docs/history.md](docs/history.md)。

## [Unreleased]

本节**不维护手写清单**，也不代表「没有未发布变更」。SSOT 与生成方式：

- **逐版本用户可见变更的 SSOT 是 GitHub Release 正文**：由 git-cliff 按 Conventional Commits 从 tag 区间自动生成（模板 `cliff.toml`，生成与发布步骤在 `.github/workflows/release.yml` 的 `Generate release notes with git-cliff` / `Create GitHub Release`）。已发布列表见 [GitHub Releases](https://github.com/TokenDanceLab/AgentHub/releases)。
- **本文件是不可变历史**：只保留已发布版本的 longform 破坏性变更/升级注意，`scripts/verify/verify-doc-ssot.py` 也按此对待本文件（不做活跃文档扫描）并施加行数预算。手写 Unreleased 列表既必然落后于 master，又会挤占该预算，所以明确不做。
- 打新 tag 发布时，按需在此追加一节 longform（破坏性变更 + 升级注意）；commit 级明细去 Release 正文看，不复制进本文件。

## v0.6.1 (2026-08-12)

### 破坏性变更

本节列出本轮 v0.6.1 中需要客户端/运维同步变更的硬性兼容性破坏。每条都对应仓库内可定位的代码/配置点。

- **`AuthFailClosed` 默认行为切换**：access-token jti 黑名单检查在 Redis 错误时不再 fail-open 放行。生产 compose 模板置 `AGENTHUB_AUTH_FAIL_CLOSED=true`（`hub-server/internal/config/constants.go` `AuthFailClosedDefault=false`，生产模板显式覆盖）。**影响**：Redis 中断期间已登出（吊销）的 access JWT 会被拒绝（401），不再"借故障复活"。dev 环境仍默认 fail-open。详见 [docs/architecture/05-deployment.md](docs/architecture/05-deployment.md) §安全配置。
- **`RATE_LIMIT_FAIL_OPEN=false`（生产）**：非认证限流器在 Redis 错误时 fail-closed 返回 503 `rate_limit_unavailable`（`hub-server/internal/config/constants.go` `RateLimitFailOpenDefault=true`，生产模板显式覆盖为 `false`）。**影响**：Redis 中断时非认证路径不再"借故障放行"，客户端可能收到 503。认证路径（`/client/auth/*`）始终 fail-closed，与本开关无关。
- **PKCE 强制 `S256`**：OIDC code 交换拒绝非 S256 的 `code_challenge_method`（`hub-server/internal/service/oidc/oidc.go:115`，`code_challenge_method must be S256`）。**影响**：使用 `plain` 或不带 challenge 的旧客户端会被 400 拒绝。所有客户端必须发 S256 verifier。
- **RS256 JWKS 强制**：TokenDance ID ID token 验签固定 RS256，拒绝 JWKS 中 `alg != RS256` 的 key（`hub-server/internal/jwtutil/tokendance.go:162`），并显式 pin 方法到 RS256（`:247`，`WithValidMethods` + keyfunc alg check）。**影响**：依赖 HS256/RS384/none 的伪造或历史 token 被拒。Hub 内部 session JWT 仍是 HS256（不变），本次破坏仅针对 TDID ID token 校验路径。
- **限流 `code` 规范化为 snake_case `rate_limited`**：429 限流响应的 envelope `code` 固定为 `rate_limited`（`pkg/errcode/codes.go` `RateLimited`），WS 连接限流为 `ws_rate_limited`。**影响**：历史 fixture/test 里出现的 `RATE_LIMITED`（UPPER）或 `too_many_requests`（共享 `ErrTooManyRequests.Code`）不再是 production wire 值；按字符串等值匹配 `RATE_LIMITED` 的客户端会失效。响应头始终带 `Retry-After`（秒），客户端必须遵守。

### 升级注意

部署到本轮镜像前/后需要做的事，按时间顺序：

- **env 核对**：生产 `.env.production`（由 `deployments/production/.env.example` 派生）必须显式设置 `AGENTHUB_AUTH_FAIL_CLOSED=true` 与 `AGENTHUB_RATE_LIMIT_FAIL_OPEN=false`，否则沿用 dev 默认（fail-open），无法获得 Wave7 安全加固。`PG_HOST` 只写主机不带端口（端口走 `PG_PORT`），`AGENTHUB_JWT_SECRET` 必须 ≥32 字符且不在 `change-me-production*` / `dev-secret-change-in-production*` 前缀 blocklist 内。完整必填变量表见 [docs/architecture/05-deployment.md](docs/architecture/05-deployment.md) §必填变量表。
- **迁移维护窗口**：`hub-server/migrations/0062_agent_team_runs_indexes` 与 `0063_agent_run_events_unique_seq` 使用普通 `CREATE INDEX` / `CREATE UNIQUE INDEX`（**非** `CONCURRENTLY`），在已堆积数据的 `agent_team_runs` / `agent_run_events` 表上会取 `ACCESS EXCLUSIVE` 锁阻塞写入。server 二进制启动时 `RunMigrations` 自动执行（`cmd/server-hub/main.go:44`），所以"直接 `docker compose up` 滚动升级"在流量高峰可能造成短时写阻塞。**建议**：大表部署在维护窗口执行（停服 → 跑迁移 → 起服），不要在高峰直接滚动。小表/空表无影响。
- **OIDC 回调集合核对**：本轮回调契约对齐（issue #1651/#1656）。若你的 `AGENTHUB_TOKENDANCE_ID_REDIRECT_URI` / `AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS` 与 TDID 侧 `oauth_clients.redirect_uris` 不同步，登录会在 `redirect_uri not allowed` 处失败。三条权威回调见 [docs/architecture/05-deployment.md](docs/architecture/05-deployment.md) §OIDC 回调契约。
- **客户端限流码适配**：若客户端按 `code === "RATE_LIMITED"` 或 `code === "too_many_requests"` 字符串判断限流，改为 `code === "rate_limited"`（WS 为 `ws_rate_limited`），并读取 `Retry-After` 头做退避。

### 迁移收尾 + Go toolchain + CI 门禁接线（迁移通道）

- 安全门禁四修（AH-SR-051）：迁移触发器双炸弹修复链、Go toolchain 升级、CI 门禁接线补齐、文档版本对齐。
- 迁移 0061 `audit_rechain_trigger_fix`：0058 re-chain DO 块被 0040 BEFORE UPDATE 触发器拒绝（0040 先于 0058 应用），up/down 双向 deploy 炸弹；0061 用 `DISABLE/ENABLE TRIGGER USER` 外包重链，镜像 integration 测试的旁路方式，同事务自愈。
- 迁移 0062 `agent_team_runs_indexes` + 0063 `agent_run_events_unique_seq`：team runs 查询路径与 run events 唯一 seq 修复。锁风险注记：两迁移非 `CONCURRENTLY`，在大表上建索引持 SHARE 锁阻塞写入，建议维护窗口低峰执行。
- 迁移 0066 `agent_team_runs_token_usage`：`token_usage_total` 计数器列 + backfill 通道（skeleton in repository layer），为 Wave5 计数器回填预留，旧查询路径不破坏。
- 迁移 0064 `execution_target_invariants_not_valid`：0060 用 plain `ADD CONSTRAINT` 全表验证（脏历史库上首行违例即半装 deploy 炸弹）；0064 改为 `DROP → ADD ... NOT VALID → 逐约束违规计数 → 0 违规 VALIDATE`，legacy 行不重扫、新写立即被约束拦截，Wave5 backfill 留给计数器列通道。
- 迁移 0065 `redundant_index_cleanup`：删除三个冗余二级索引——`idx_delivery_outbox_delivery_id`（与 `delivery_id UNIQUE` 重复）、`idx_agent_team_events_run_id`（0056 复合 UNIQUE 前缀）、`idx_notifications_user_id`（0013 复合前缀）。
- 迁移 0058.down / 0016.down 回滚链修复：0058.down 补 `DISABLE/ENABLE TRIGGER USER` 外包（镜像 0061.up）；0016.down 在 `ADD CONSTRAINT fk` 前插 `INSERT INTO devices(id) VALUES(零UUID) ON CONFLICT DO NOTHING`，消除 FK 校验卡死。
- Go toolchain 1.25.0 → 1.26.5：`go.work` + `hub-server/edge-server/pkg` go.mod + 5 个 workflow `GO_VERSION`（checks/cd-pr-check/cd-production/release/release-readiness）；README/README_EN go 徽章 + developer-quickstart 同步；修复 govulncheck GO-2026-5037/5038/5039 stdlib 漏洞（需 1.26.4+）。4970/5856 需 1.27 的依赖本轮不解决，登记为例外。
- i18n callsites ratchet 接线（#1612）：`verify-i18n-callsites.py` 接入 `checks.yml → validate` 并补 `AGENTS.md §9.5` 映射行；当前两前端文件有 CJK 字面量回退（`ui/CodeBlock.tsx`、`workbench/workbenchTestMocks.ts`），暂以 advisory（continue-on-error）接线，backfill 后翻 hard-fail。
- 前端：Toast 合一、56-prop Step1（首个 domain assembler 切片落地）、PageErrorBoundary、死代码删除、openapi 死路径删除、bus/ws 单源（ADR-019）、ACP 收敛、dispatch 语义/停机/jitter/CAS、hubClient 401 接线、WS 重连补数据、bundle lazy、巨石拆分。
- Tauri 安全加固（ADR-021）：SSRF 防护、command 门控、sidecar 重启策略。

### Wave5/6：安全加固 + 可观测性 + 契约对齐 + 前端性能 + mobile 装配 + CI/Renovate

- hub 安全加固：AuthFailClosed 默认（access-token 校验失败即拒，`AuthFailClosedDefault`）；PKCE 强制；RS256 JWKS；err.Error 清洗（不向客户端回显内部错误）；rate limit code 规范化（`RateLimitFailOpenDefault` 仅覆盖非 auth 路径，auth 路径恒 fail-closed）。
- 可观测性：request_id 跨层关联；persist 重试与离线队列 cap；`/health` 503 降级；截断指标暴露；PostgreSQL 23505 唯一冲突重试。
- 契约对齐：List 响应形状统一；Message schema 收敛；429 文档化；107 op 错误响应规范；Check E 边界。
- 前端性能：useDesktopEdgeEvents 批处理；DocxPreview style 收敛；CSP 收紧。
- mobile 装配（mobileAuth 通道）：push 通知、OIDC deep-link、SecureStore token 存储。
- circuit breaker：出站调用熔断与半开探测。
- budget（迁移 0066 `agent_team_runs_token_usage`）：`token_usage_total` 计数器列 + backfill 通道（skeleton in repository layer）。
- client_msg_id：客户端消息幂等键落地。
- event_log 持久化：事件日志 append-only JSON-lines 落库与回放。
- auth.ok 首帧：WS 鉴权成功后立即下发 auth.ok 帧。
- pingAll 并行：健康检查并行化。
- a11y：键盘焦点、ARIA、对比度修复。
- CI/Renovate：Go test job 合并；shard matrix；cargo-audit 改 binstall；`.github/renovate.json` 入场（renovate：npm/gomod/cargo/dockerfile/github-actions/docker-compose managers，patch 绿后 auto-merge，minor 周审，major 单独 PR；Expo/Storybook/vite/TS major 排除）。

## v0.6.0 (2026-08-06)

- 发布门禁：版本升至 0.6.0；release 的 build-mobile 改为 `RELEASE_MOBILE_ENABLED` 门控（EAS/EXPO_TOKEN 未配置时跳过 APK，不再阻塞发布）。
- 修复 hub-server：Timeout 中间件不再包装 WebSocket upgrade 请求（此前缓冲 writer 不支持 hijack，WS 握手永久挂起）；未认证请求跳过权限审计（此前 user_id 空串导致 PostgreSQL uuid 报错污染日志）。
- 修复部署：根 `docker-compose.yml` 的 hub-server build context 改为仓库根（此前 `./hub-server` 与 Dockerfile 的 `COPY go.work/pkg/edge-server` 冲突，`docker compose up --build` 必然失败）。
- 新增 `scripts/e2e/verify-wsl-full-stack-e2e.py`：WSL 容器形态全栈 E2E（tokendance-id + hub-server + PG16 + Redis7），真实 OIDC PKCE 登录流 18 项断言 + integration 级证据 manifest（`real_tokendance_id_login=true`）。
- 测试基建：偿还 golangci-lint v2.12.2 对测试文件的 gosec G101/G306 与 staticcheck QF1008/QF1002 finding（master 基线漂移修复）。
- 修复桌面 macOS 发布链路（自 v0.5.0 起 macOS DMG 从未构建成功，v0.6.0 验证过程逐层修复）：恢复 `apple-native-keyring-store` 的 `keychain` feature（#1643）；修正 `keychain::Store` 模块路径（#1644）；macOS 构建改用 `--bundles dmg` 覆盖仅含 nsis 的 bundle targets（#1645）；应用图标 PNG 16-bit → 8-bit RGBA（#1646）；release job 放行 skipped 依赖（#1647）；`mobile-artifacts` 条件下载（#1648）。
- 上一版（v0.5.0 及更早）的完整历史见 [docs/history.md](docs/history.md)。

## 历史

| 版本范围 | 位置 |
|---|---|
| v0.1.0 - v0.5.2 longform | [docs/history.md](docs/history.md) |
| 2026-06-17 release materials | [docs/history.md](docs/history.md) |
| 已完成 spec-driven 专项 | [docs/history.md](docs/history.md) |
