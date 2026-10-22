# Changelog

已发布版本的 longform release notes（破坏性变更、升级注意、release gate 结论及其他重大变更）在这里；commit 级明细由 git-cliff 生成到 [GitHub Releases](https://github.com/TokenDanceLab/AgentHub/releases)。

## v0.7.1 (2026-10-22)

### 安全更新

- Go toolchain、Hub/Edge 模块与 Docker builder 升至 `1.27.3`，覆盖 `GO-2026-6809` / `CVE-2026-111943` 等 `1.26.10` 之前修复的 stdlib 风险；`govulncheck` 对 Hub/Edge 均为 0 个可达漏洞。
- 前端构建链升至 Vite `6.4.5`、Storybook `8.6.19`；Tauri Rust 依赖补齐 `RUSTSEC-2026-0381/0382/0383` 的上游修复版本。
- Hub Server 发布镜像现在把发布 tag 注入二进制 `Version`，不再把可发布镜像报告为 `version=dev`。

### 升级注意

- 这是安全基线补丁发布；HTTP/WS 协议、数据库迁移和部署变量无破坏性变更。
- 发布 tag 前须由维护者记录本次安全风险评审（`RELEASE_RISK_REVIEWED=v0.7.1`），否则 release gate 按设计冻结。

## v0.7.0 (2026-10-20)

### 破坏性变更

无。自 v0.6.1 起约 590 个提交中没有 BREAKING 标记；HTTP/WS 协议、错误码与数据库迁移保持向后兼容，升级不需要手工迁移步骤。

### 主要内容

- **前端设计系统换代**：Tailwind v4 + shadcn token 桥、vendored primitives；聊天转录、输入区、壳层、Inspector 按新视觉重构，旧的玻璃拟态与重复 chrome 删除。
- **工作台 UX**：会话分屏与并行 review、会话级目标横幅、Tasks 看板与双向深链、run 内可见派发队列、checkpoint 时间线、全局底部状态栏、产物卡直达预览。
- **可靠性与安全**：WS seq gap 检测与自动重同步、JWT 密钥轮换调度器、特权动作审计链、OIDC 错误码前后端 SSOT、限流与错误面显式化。
- **桌面端**：relay 命令与设备凭据 ack、自托管字体（去掉 Google Fonts 外呼）并收紧 CSP。

### 升级注意

- 桌面端按 `RELEASE_UNSIGNED_OK=true` 以未签名方式发布：Windows 首次安装会有 SmartScreen 提示，更新元数据自签名；macOS DMG/公证不在本次范围。
- 发布 tag 前须由维护者记录本次安全风险评审（`RELEASE_RISK_REVIEWED=v0.7.0`），否则 release gate 按设计冻结。

## v0.6.1 (2026-08-12)

### 破坏性变更

本节列出 v0.6.1 中需要客户端/运维同步变更的硬性兼容性破坏。每条都对应仓库内可定位的代码/配置点。

- **`AuthFailClosed` 默认行为切换**：access-token jti 黑名单检查在 Redis 错误时不再 fail-open 放行。Go 默认值为 `false`（`hub-server/internal/config/constants.go` `AuthFailClosedDefault=false`）；dev 与生产 compose 模板均显式设置 `AGENTHUB_AUTH_FAIL_CLOSED=true`。**影响**：Redis 中断期间已登出（吊销）的 access JWT 会被拒绝（401），不再"借故障复活"；只有不经 compose、直接以 Go 默认值启动的进程仍 fail-open。详见 [docs/architecture/05-deployment.md](docs/architecture/05-deployment.md) §安全配置。
- **`RATE_LIMIT_FAIL_OPEN=false`（生产）**：非认证限流器在 Redis 错误时 fail-closed 返回 503 `rate_limit_unavailable`（`hub-server/internal/config/constants.go` `RateLimitFailOpenDefault=true`，生产模板显式覆盖为 `false`）。**影响**：Redis 中断时非认证路径不再"借故障放行"，客户端可能收到 503。认证路径（`/client/auth/*`）始终 fail-closed，与本开关无关。
- **PKCE 强制 `S256`**：授权 URL 生成阶段拒绝非 S256 的 `code_challenge_method`（`hub-server/internal/service/oidc/oidc.go:116`，`code_challenge_method must be S256`）。**影响**：使用 `plain` 或不带 challenge 的旧客户端会被 400 拒绝。所有客户端必须发 S256 verifier。
- **RS256 JWKS 强制**：TokenDance ID ID token 验签固定 RS256，拒绝 JWKS 中 `alg != RS256` 的 key（`hub-server/internal/jwtutil/tokendance.go:167`），并显式 pin 方法到 RS256（`:271`，`WithValidMethods` + keyfunc alg check）。**影响**：依赖 HS256/RS384/none 的伪造或历史 token 被拒。Hub 内部 session JWT 仍是 HS256（不变），本次破坏仅针对 TDID ID token 校验路径。
- **限流 `code` 规范化为 snake_case `rate_limited`（Hub）**：Hub 的 429 限流响应 envelope `code` 固定为 `rate_limited`（`pkg/errcode/codes.go` `RateLimited`），WS 连接限流为 `ws_rate_limited`。**影响**：历史 Hub fixture/test 里出现的 `RATE_LIMITED`（UPPER）不再是 production wire 值；按字符串等值匹配 `RATE_LIMITED` 的客户端会失效。Edge 域继续使用 `too_many_requests`。所有 429 响应带 `Retry-After`（秒），客户端必须遵守。

### 升级注意

部署 v0.6.1 镜像前/后需要做的事，按时间顺序：

- **env 核对**：生产 `deployments/production/docker-compose.yml` 已把 `AGENTHUB_AUTH_FAIL_CLOSED=true` 与 `AGENTHUB_RATE_LIMIT_FAIL_OPEN=false` 硬编码在 Hub service 的 environment 中，`deployments/production/.env` 无需设置、也无法覆盖这两项；需要调整时直接修改 compose。`deployments/production/.env`（由 `deployments/production/.env.example` 派生，docker compose 自动读取）仍需提供其余必填变量：`PG_HOST` 只写主机不带端口（端口走 `PG_PORT`），`AGENTHUB_JWT_SECRET` 必须 ≥32 字符且不在 `change-me-production*` / `dev-secret-change-in-production*` 前缀 blocklist 内。完整必填变量表见 [docs/architecture/05-deployment.md](docs/architecture/05-deployment.md) §必填变量表。
- **迁移维护窗口**：`hub-server/migrations/0062_agent_team_runs_indexes` 与 `0063_agent_run_events_unique_seq` 使用普通 `CREATE INDEX` / `CREATE UNIQUE INDEX`（**非** `CONCURRENTLY`），在已堆积数据的 `agent_team_runs` / `agent_run_events` 表上会取 `SHARE` 锁阻塞写入（读取不受影响）。server 二进制启动时 `RunMigrations` 自动执行（`hub-server/cmd/server-hub/main.go:44`），所以"直接 `docker compose up` 滚动升级"在流量高峰可能造成短时写阻塞。**建议**：大表部署在维护窗口执行（停服 → 跑迁移 → 起服），不要在高峰直接滚动。小表/空表无影响。
- **数据库 TLS 默认值**：生产 compose 默认 `PG_SSLMODE=require` 且注入 `AGENTHUB_ENV=production`；production guard 会拒绝 `db.sslmode=disable`。升级前确认宿主 PostgreSQL 接受 TLS，或显式改用非 production 环境标签。
- **OIDC 回调集合核对**：v0.6.1 回调契约对齐（issue #1651/#1656）。若你的 `AGENTHUB_TOKENDANCE_ID_REDIRECT_URI` / `AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS` 与 TDID 侧 `oauth_clients.redirect_uris` 不同步，登录会在 `redirect_uri not allowed` 处失败。三条权威回调见 [docs/architecture/05-deployment.md](docs/architecture/05-deployment.md) §OIDC 回调契约。
- **客户端限流码适配**：若客户端按 `code === "RATE_LIMITED"` 判断 Hub 限流，改为 `code === "rate_limited"`（WS 为 `ws_rate_limited`）；Edge 域继续返回 `too_many_requests`。所有 429 都读取 `Retry-After` 头做退避。

### 迁移、Go toolchain 与 CI 门禁

- 安全门禁四修：迁移触发器连锁失败修复、Go toolchain 升级、CI 门禁接线补齐、文档版本对齐。
- 迁移 0061 `audit_rechain_trigger_fix`：0058 re-chain DO 块被 0040 BEFORE UPDATE 触发器拒绝（0040 先于 0058 应用），up/down 双向均无法完成；0061 用 `DISABLE/ENABLE TRIGGER USER` 外包重链，镜像 integration 测试的旁路方式，同事务自愈。
- 迁移 0062 `agent_team_runs_indexes` + 0063 `agent_run_events_unique_seq`：team runs 查询路径与 run events 唯一 seq 修复。锁风险注记：两迁移非 `CONCURRENTLY`，在大表上建索引持 SHARE 锁阻塞写入，建议维护窗口低峰执行。
- 迁移 0066 `agent_team_runs_token_usage`：`token_usage_total` 计数器列 + backfill 通道（skeleton in repository layer），为后续计数器回填预留，旧查询路径不破坏。
- 迁移 0064 `execution_target_invariants_not_valid`：0060 用 plain `ADD CONSTRAINT` 全表验证（脏历史库上首行违例即中断并留下半装约束）；0064 改为 `DROP → ADD ... NOT VALID → 逐约束违规计数 → 0 违规 VALIDATE`，legacy 行不重扫、新写立即被约束拦截，后续 backfill 留给计数器列通道。
- 迁移 0065 `redundant_index_cleanup`：删除三个冗余二级索引——`idx_delivery_outbox_delivery_id`（与 `delivery_id UNIQUE` 重复）、`idx_agent_team_events_run_id`（0056 复合 UNIQUE 前缀）、`idx_notifications_user_id`（0013 复合前缀）。
- 迁移 0058.down / 0016.down 回滚链修复：0058.down 补 `DISABLE/ENABLE TRIGGER USER` 外包（镜像 0061.up）；0016.down 在 `ADD CONSTRAINT fk` 前插 `INSERT INTO devices(id, user_id, device_type) VALUES(零UUID, 零UUID, 'system') ON CONFLICT DO NOTHING`（补齐 NOT NULL 列），消除 FK 校验卡死。
- Go toolchain 1.25.0 → 1.26.5：`go.work` + `hub-server/edge-server/pkg` go.mod + 5 个 workflow `GO_VERSION`（checks/cd-pr-check/cd-production/release/release-readiness）；README/README_EN go 徽章 + developer-quickstart 同步；修复 govulncheck GO-2026-5037/5038/5039 stdlib 漏洞（需 1.26.4+）。
- 前端 i18n callsite 清理（#1612）：残留 CJK 字面量按文件逐步收敛。
- 前端：Toast 合一、workbench 组件 props 收敛、PageErrorBoundary、死代码删除、openapi 死路径删除、bus/ws 单源（ADR-019）、ACP 收敛、dispatch 语义/停机/jitter/CAS、hubClient 401 接线、WS 重连补数据、bundle lazy、巨石拆分。
- Tauri 安全加固（ADR-023）：SSRF 防护、command 门控、sidecar 重启策略。

### 安全加固 + 可观测性 + 契约对齐 + 前端性能 + mobile 装配 + CI/Renovate

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
- v0.6.1 之前的版本只保留 Git tag、Git 历史与本文件中的 longform；GitHub Releases 从 v0.6.1 起。
