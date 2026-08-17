# 09 — 远程 Dev 服务器拓扑（L3 真实测试面）

> 真实测试面（L3）的服务器侧拓扑定义。分层概念见根 `AGENTS.md` §5.5；
> 平台设计决策见 issue #1681。本文只记形状与契约，**不记地址/主机/
> secret**（见 §9.6 隐私规则与 §4 secret 指针）。

## 端口矩阵

| 服务 | 端口 | 形态 |
|---|---|---|
| TokenDance ID | 3000 | 宿主二进制（sqlite） |
| Hub Server | 8080 | 宿主二进制（go build 产物，PG16+Redis） |
| Edge Server | 3210 | 宿主二进制（go build 产物） |
| Web Vite（workbench） | 5174 | 宿主 node 进程 |
| PostgreSQL 16 | 5432 | Docker 容器（compose 纳管） |
| Redis 7 | 6379 | Docker 容器（compose 纳管） |

固定端口与本地开发一致（见 `AGENTS.md` §2 固定端口表），避免两套契约。

## 运行模型

| 层 | 纳管方式 | 理由 |
|---|---|---|
| PG/Redis | `docker compose up -d postgres redis`（根 compose，`restart: unless-stopped` 自愈） | 数据面，容器语义 |
| hub/edge | go build 产物 + pidfile（`/tmp/agenthub-*.pid`）直跑 | 编译型前台进程，pidfile 让停止精确（go run 会 spawn 子进程，pidfile 记不住） |
| ID/web | 服务器本地启动（一次性/手动） | 低频变更，暂不平台化（#1681 设计已交付，未排期自动化） |

## 身份链（OIDC）

- ID 是 issuer（本地 loopback），OAuth client「AgentHub dev」注册一次。
- hub 走 OIDC Authorization Code + PKCE，code 换 session，`tokendance_sub` 关联本地账号。
- 回调契约：hub 回调 `127.0.0.1:8080/client/auth/oidc/callback`；web 回调
  `5174` 两个别名。与根 compose 的 `AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS`
  默认值保持一致。
- client 注册入口：`hub-server/scripts/setup-tokendance-oidc.sh`（API/sqlite-seed 双模式）。

## 环境适配（服务器本地）

- DNS 自愈与 Go 镜像代理是服务器环境属性，由服务器本地配置承载
  （`devserver.sh` 只透传 `DEVSERVER_GOPROXY` 开关，不内置任何镜像地址）。
- secret 全部在服务器本地 `.env`（gitignored），`devserver.sh start` 逐键
  fail-closed 校验缺失，值永不出服务器。

## 重建步骤（服务器失联后）

1. 克隆仓库 + `docker compose up -d postgres redis`。
2. 部署 ID（独立产品线，按 identity 文档重建 sqlite + OAuth client）。
3. 写本地 `.env`（键清单见 `devserver.sh start` 的循环列表）。
4. 本地 `~/.ssh/config` 配好 alias 后 `scripts/dev/devserver.sh start`。
5. `devserver.sh status` 四服务 OK 即重建完成。

## 证据纪律

- `devserver.sh sync` 只在服务器工作树干净时允许快进；脏树先处理。
- `devserver.sh test` 报告回传本地 `.tmp/devserver-reports/`（gitignored），
  含 commit/branch/arch/结果，可附 PR/issue 作为 L3 证据。
