# Codex Session 2026-05-25 — 后端修复交接报告

> 接单人：Codex (Opus)。本报告覆盖 2026-05-25 晚间后端批次全部工作、当前代码状态、剩余 issue 和下一步推荐。

---

## 0. 2026-05-25 TokenDance ID 接入部署补记

本轮已把 Hub Server 的 TokenDance ID OIDC 后端接入部署到生产服务器，服务器侧未执行构建，只执行本地构建产物的 `docker load` 与 `docker compose ... up -d --no-build --force-recreate`。

### 0.1 已推送 Commit

| Commit | 内容 |
|--------|------|
| `8d06b9a` | Hub-owned TokenDance ID OIDC authorize/callback、JWKS 校验、`tokendance_sub` 映射、Hub session 签发 |
| `45f9ba1` | 生产 compose 传入 TokenDance ID OIDC env，补 redirect URI 配置校验 |
| `0169c35` | 修复 Hub migration 文件版本序列，避免重复版本导致生产启动失败 |
| `14e0d42` | 显式兼容 `AGENTHUB_TOKENDANCE_ID_*` 生产 env；保留 `AGENTHUB_TOKENDANCE_*` legacy 名称 |

### 0.2 本地构建与部署证据

- 本地干净快照构建：`git archive HEAD` → `go test ./... -short -count=1` → `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build` → runtime-only Docker image。
- 已上传并加载到生产服务器的最终产物：`agenthub-hub-14e0d42.tar`，SHA-256 `edd5fc5548f1276a80ef7d5261562b4298f50079f915e6065c455292f12987af`。
- 生产服务器最终运行镜像：`deployments-hub-server:14e0d42` / `deployments-hub-server:latest`，image id prefix `ad68c4ed38e1`。
- production health：`GET http://127.0.0.1:8090/health` 返回 `200`，`database=ok`、`redis=ok`、`migrations=28`。
- OIDC authorize smoke：`POST /client/auth/oidc/authorize` 返回 `200`，授权 URL 指向 `https://id.vectorcontrol.tech/oidc/authorize`，client id 为 `[REDACTED]`，redirect URI 为 `https://hub.vectorcontrol.tech/client/auth/oidc/callback`，PKCE method 为 `S256`。
- 负向 smoke：非法 `device_id` 返回 `400 BAD_REQUEST`，message 为 `device_id must be a UUID`。
- CORS smoke：`Origin: https://hub.vectorcontrol.tech` 返回 `Access-Control-Allow-Origin: https://hub.vectorcontrol.tech`；`Origin: http://localhost:3000` 返回 `403`。

### 0.3 线上修正记录

- `.env.production` 中旧 CORS 默认包含 localhost，`0169c35` 首次启动在生产 CORS 保护处 panic；已备份并将 `AGENTHUB_CORS_ORIGINS` 收敛为 `https://hub.vectorcontrol.tech`。
- 因 `0169c35` 已成功把 DB migration 推进到 28，旧 rollback 镜像缺少 0028 migration 文件，不能再直接接管当前 DB；后续回滚需使用包含 0028 migration 的镜像或先做明确 DB 降级计划。
- 生产 compose 使用 `AGENTHUB_TOKENDANCE_ID_*` 变量；`14e0d42` 修复配置加载器后 OIDC handler 正常注册。

---

## 1. 本轮完成了什么

### 1.1 Commit 列表（11 个，d952655 → 6fcf079）

| Commit | 内容 |
|--------|------|
| `9b5c69d` | **Team 3 — WS + Auth + Middleware**：#178 多设备路由 / #96 消息撤回 / #93 已读序列 / #88 typing 校验 / #78 会话缓存 / #82 WS 认证对齐 |
| `f06391a` | **Team 1**：分配序列号后更新会话 last_message_at（#154） |
| `47bc9fc` | **Team 1**：过期扫描包含 running 状态的 agent 任务（#132） |
| `d3d1fc5` | **Team 1**：好友备注可清空 + UpdateRemark 无行影响返回 404（#159 #120） |
| `967718e` | **Team 1**：消息搜索支持内容类型和时间范围过滤（#157） |
| `8d670ae` | **Team 1**：创建私聊会话前验证双方好友关系（#122） |
| `0a1d1f5` | **Team 2 — Agent**：stream 去重 + 生命周期强制 + 离线 dispatched + 心跳过期 + 会话刷新 + 队列日志（#130 #109 #99 #132 #154 #137） |
| `5fd5574` | **Team 2 — Edge**：NDJSON 解析失败时终止 run 并上报失败状态（#179） |
| `576768a` | **Team 2 — Edge**：CLI 二进制可用性检测上报 + cancel 缺失/已完成 run 响应对齐（#177 #108） |
| `43b7d6a` | merge: feat/team-hub-core-service → dev/delicious233 |
| `6fcf079` | merge: feat/team-agent-edge-callbacks → dev/delicious233（含 repository/agent.go 冲突解决） |

### 1.2 已关闭 Issue（19 个）

#154 #132 #159 #120 #157 #122 #130 #109 #99 #137 #179 #177 #108 #178 #96 #93 #88 #78 #82

### 1.3 关键修复摘要

| 层面 | 修复 |
|------|------|
| **Agent 生命周期** | stream 通过 client_msg_id 幂等去重；done/fail 只接受 running/dispatched 状态；离线回放任务标记 dispatched；running 任务心跳过期 |
| **消息/会话** | 私聊前校验好友关系；搜索支持 content_type + 时间范围过滤；last_message_at 随 seq 分配更新；备注可清空 |
| **Edge 适配器** | NDJSON 解析失败 run 标记 failed；exec.LookPath 检测 CLI 可用性；cancel 缺失/terminal run 正确响应 |
| **WebSocket** | 多设备 byUser 改用 connID；typing 前校验成员身份；已读序列前进校验；认证复用 Gin middleware 上下文 |
| **缓存一致性** | DeleteForMe 后失效 member cache；UpdateRemark 无行影响返回 404 |

---

## 2. 当前代码状态

| 服务 | 分支 | HEAD | 测试 |
|------|------|------|:--:|
| **hub-server** | dev/delicious233 | 6fcf079 | 13/13 全绿 |
| **edge-server** | dev/delicious233 | 6fcf079 | 15/15 全绿 |

已 push 到 `origin/dev/delicious233`。

---

## 3. 剩余待处理（后端范围）

### 3.1 纯后端 Issue（5 个，可直接修）

| # | Issue | 文件提示 | 优先级 |
|---|-------|---------|:--:|
| **145** | Honor the configured upload directory for attachment storage | `hub-server/internal/handler/attachment.go` — 读取 `config.Upload.Dir` 而非硬编码 | P2 |
| **142** | Document request bodies for Hub Edge task stream and done callbacks | `api/openapi.yaml` — 补 `/edge/agent-tasks/{id}/stream`、`/done`、`/fail` 的 request body schema | P2 |
| **138** | Align register request and response contract between OpenAPI and Hub | `api/openapi.yaml` + `hub-server/internal/handler/device.go` — 统一 device register 的请求/响应字段 | P2 |
| **173** | Normalize or validate non-text message content before jsonb writes | `hub-server/internal/service/message.go` — 发送 image/file/rich_text 时校验 content jsonb 结构 | P2 |
| **105** | Align CI gates with the documented security and coverage policy | `.github/workflows/checks.yml` — hub 覆盖率 40% 硬阻断 + gosec/govulncheck 强制 | P2 |

### 3.2 B7 CI/文档/清理 剩余

| # | Issue | 说明 |
|---|-------|------|
| 164 | Remove tracked Go coverage profiles | `.gitignore` + `git rm --cached` |
| 74 | Remove tracked Edge coverage profile artifact | 同上 |
| 95 | Remove localhost origins from production CORS example | `hub-server/deployments/.env.production.example` |
| 90 | Bind dev compose services to loopback by default | 已在 AH-SR-008 缓解，需验证 |

### 3.3 安全验证队列（部署态）

| ID | 待验证 |
|----|--------|
| AH-SR-016 | 生产 CORS localhost 拒绝 smoke |
| AH-SR-017 | Admin pprof/metrics 外部不可达验证 |
| AH-SR-018 | Live runtime 截断 metadata smoke |
| AH-SR-019 | 部署态 UUID device_id 客户端覆盖验证 |

---

## 4. 开发约定

### 4.1 文件边界与分层

```
hub-server/
  internal/handler/   ← HTTP 层（参数校验、响应格式化）
  internal/service/   ← 业务逻辑层（事务、权限、缓存）
  internal/repository/ ← 数据访问层（GORM 查询）
  internal/middleware/ ← 认证、CORS、限流、超时
  internal/ws/        ← WebSocket 连接管理
  internal/model/     ← GORM 模型定义
  internal/config/    ← 配置结构 + 常量

edge-server/
  internal/adapters/   ← Agent CLI 协议适配器（Codex/Claude/OpenCode）
  internal/lifecycle/  ← 进程执行器、Run 生命周期
  internal/api/        ← HTTP handler（REST + WebSocket）
  internal/events/     ← EventBus 实现
  internal/store/      ← 内存存储 + FileStore 持久化
  internal/security/   ← Origin 校验、地址绑定校验
```

### 4.2 测试规范

- 每个修复必须：先写失败测试 → 修代码 → 测试变绿
- 参考同包已有测试的 mock 方式和命名风格
- handler 测试用 `go-sqlmock`，service 测试用 mock 接口
- 验证命令：`go test ./... -short -count=1` + `go test -race ./... -short -count=1`

### 4.3 提交规范

```
type(scope): 中文摘要

type: feat|fix|docs|refactor|chore|test|perf|ci|revert
scope: hub|edge|desktop|web|api|docs
```

---

## 5. 下一步推荐

1. **修剩余 5 个后端 issue**（#145 #142 #138 #173 #105）— 预估 2-3h，无需 worktree/team
2. **关 B7 文档/清理 issue**（#164 #74 #95 #90）— 预估 1h
3. **部署态安全验证**（AH-SR-016/017/018/019）— 需生产环境访问
4. **继续推进 B6 Desktop IM/Hub 对接** — 需前端 Agent 配合

### 5.1 快速开始

```powershell
git checkout dev/delicious233 && git pull --ff-only
cd hub-server && go test ./... -short -count=1   # 确认基线 13/13
cd ../edge-server && go test ./... -short -count=1 # 确认基线 15/15
```

### 5.2 参考文档

| 文档 | 路径 |
|------|------|
| 系统架构 | `docs/architecture/system-design/system-architecture.md` |
| 安全风险登记册 | `docs/governance/security-risk-register.md` |
| 全局路线图 | `docs/tutorials/roadmap.md` |
| 项目状态 | `docs/development/handoffs/STATE.md` |
| 开发规范 | `AGENTS.md` |
| API 契约 | `api/openapi.yaml` |
| WebSocket 事件 | `api/events.md` |
