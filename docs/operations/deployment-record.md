# AgentHub Hub Server — 生产部署记录

最后更新：2026-05-27

## 部署拓扑

```
Cloudflare DNS (api.hub.vectorcontrol.tech A → 38.76.183.116, DNS-only)
  → hk2 nginx:80
    → 127.0.0.1:8090 (Docker agenthub-hub)
      → Docker 网络 agenthub-net
        ├── agenthub-postgres:5432 (独立实例)
        └── agenthub-redis:6379 (独立实例)
```

## 服务器信息

| 项 | 值 |
|:--|:--|
| **主机** | hk2（核云 VPS，Ubuntu） |
| **IP** | 38.76.183.116 |
| **仓库路径** | `/opt/agenthub-hub/` |
| **分支** | `dev/delicious233` |
| **Docker 版本** | 29.4.3 |
| **Compose 版本** | v5.1.3 |

## Docker 服务

| 容器 | 镜像 | 端口 | 持久卷 |
|:--|:--|:--|:--|
| `agenthub-postgres` | postgres:16-alpine | 5432（仅容器网络） | `agenthub_pg_data` |
| `agenthub-redis` | redis:7-alpine (AOF) | 6379（仅容器网络） | `agenthub_redis_data` |
| `agenthub-hub` | 预构建镜像（服务器只 `docker load`，不编译） | 127.0.0.1:8090:8080 | `agenthub_uploads` |

## nginx 配置

- 配置文件：`/etc/nginx/sites-enabled/agenthub-api.conf`
- 反代：`api.hub.vectorcontrol.tech:80` → `127.0.0.1:8090`
- WebSocket 支持（IM）：Upgrade + Connection headers
- Body 大小限制：10MB
- 安全头：X-Frame-Options, X-Content-Type-Options, Referrer-Policy

## 密钥管理

- `.env.production` 路径：`hub-server/deployments/.env.production`（gitignored）
- 生成命令：`cd hub-server && bash scripts/generate-secrets.sh`
- 权限：`chmod 600`
- 不进仓库，需安全备份

## 日常运维

```bash
ssh hk2
cd /opt/agenthub-hub

# 拉取最新代码
git pull origin dev/delicious233

# 部署：先在开发机/CI 构建镜像并传到服务器，服务器只加载镜像，不运行 build
cd hub-server
docker load -i /tmp/agenthub-hub-latest.tar
docker compose --env-file deployments/.env.production -f deployments/docker-compose.prod.yml up -d --no-build --no-deps --force-recreate hub-server

# 查看日志
docker compose --env-file deployments/.env.production -f deployments/docker-compose.prod.yml logs -f hub-server

# 健康检查
curl http://localhost:8090/health
curl http://api.hub.vectorcontrol.tech/health

# 公开统计
curl http://api.hub.vectorcontrol.tech/api/public/stats
```

## 最近部署

| 时间 (UTC) | 镜像 | 变更 | 验证 |
|:--|:--|:--|:--|
| 2026-05-26 21:15 | `ghcr.io/tokendancelab/agenthub-hub:latest` -> `sha256:61d9582d1005...` | 本机预构建镜像 tar（SHA256 `46174db23b34bc0ccaa044f8b5bbac685f2b6ca3dde778796dcdbf741c5f5974`，约 35 MB）传输到 hk2 后 `docker load`，发布 commit `b9d8734`：新增 migration 0038 `agent_team_artifacts`，TeamRunState projection 刷新 artifact DB index，持久化 team_run/team_task/assignment/member/agent_task/edge_run/source_event/tool/normalized_path/conflict_id 追溯字段；预迁移备份 `/opt/agenthub-hub/hub-server/deployments/backups/agenthub-pg-pre-migration-0038-20260526T211305Z.sql.gz`（SHA256 `c56742687e6b60e5d39d91a60773ba3da46caf0100879410fb28357ff5d91b49`，7018 bytes）；服务器未执行 build；旧 latest 已保留为 `ghcr.io/tokendancelab/agenthub-hub:rollback-20260526211437-179814d` | 本地验证：`hub-server && go test ./internal/service -run "TestAgentTeamService_(GetTeamRunStateProjectsDependenciesAndBudget|ResolveConflict)" -count=1`、`hub-server && go test ./... -short -count=1`、OpenAPI YAML 解析、生产 compose config、staged diff check 和本机 Docker build 通过；部署态 Docker health `healthy`；本地/公网 `/health` migrations=38；PostgreSQL `to_regclass('public.agent_team_artifacts')` 返回 `agent_team_artifacts`；未登录访问 conflict resolve endpoint 返回 401；Docker 限制读回 Hub 256MiB/1 CPU/256 pids，PostgreSQL 512MiB/1 CPU/256 pids，Redis 384MiB/0.5 CPU/128 pids；观测 Hub ~7.3 MiB、PG ~34.9 MiB、Redis ~6.5 MiB，根盘约 9.0 GiB 可用（70% 使用）；本地/远端传输 tar 已清理 |
| 2026-05-26 21:01 | `ghcr.io/tokendancelab/agenthub-hub:latest` -> `sha256:e2a14107f0d5...` | 本机预构建镜像 tar（SHA256 `e9ee1a63b84313217a9bb6b73f9759b4f3609c13b212ca831e6b271f987c64b1`，约 35 MB）传输到 hk2 后 `docker load`，发布 commit `c951582`：新增 `POST /web/agent-teams/{id}/runs/{run_id}/conflicts/{conflict_id}/resolve`，人工 conflict resolution 写入 append-only `team.conflict.resolved` TeamEvent，TeamRunState replay 会标记 conflict `resolved` 并记录 resolution、resolved_by、resolved_at、reason、selected_agent_task_id；服务器未执行 build；旧 latest 已保留为 `ghcr.io/tokendancelab/agenthub-hub:rollback-20260526210032-c373291` | 本地验证：focused AgentTeam service/handler tests、`hub-server && go test ./... -short -count=1`、OpenAPI YAML 解析、生产 compose config、staged diff check 和本机 Docker build 通过；部署态 Docker health `healthy`；本地/公网 `/health` migrations=37；未登录访问 conflict resolve endpoint 返回 401；Docker 限制读回 Hub 256MiB/1 CPU/256 pids，PostgreSQL 512MiB/1 CPU/256 pids，Redis 384MiB/0.5 CPU/128 pids；观测 Hub ~7.2 MiB、PG ~30.2 MiB、Redis ~6.5 MiB，根盘约 9.1 GiB 可用（69% 使用） |
| 2026-05-26 20:42 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:85a1b7bf76b1...` | 本机预构建镜像 tar（约 35 MB）传输到 hk2 后 `docker load`，发布 commit `8580066`：TeamRunState approval/file-change projection 增加 `team_task_id` / `assignment_id` / `member_id` 追溯字段，并从多个 member/task 对同一路径的 file-change 事件投影 `conflicts[]` 和 artifact `conflict_id`；生产 compose 同步应用 Hub/PostgreSQL/Redis `mem_limit`、`cpus`、`pids_limit` 与 Redis 连接池默认值 20/2；服务器未执行 build；保留 `ghcr.io/tokendancelab/agenthub-hub:rollback-20260526-8580066` 回滚镜像 | 本地验证：`hub-server && go test ./internal/service -run "TestAgentTeamService_(GetTeamRunStateProjectsDependenciesAndBudget|HandleRouteDecision|DispatchAssignment)" -count=1`、`hub-server && go test ./... -short -count=1`、OpenAPI YAML 解析、生产 compose config 和 diff check 通过；部署态 Docker health `healthy`；本地/公网 `/health` migrations=37；未登录访问 TeamRunState endpoint 返回 401；Docker 限制读回 Hub 256MiB/1 CPU/256 pids，PostgreSQL 512MiB/1 CPU/256 pids，Redis 384MiB/0.5 CPU/128 pids；观测 Hub ~7.1 MiB、PG ~29.2 MiB、Redis ~6.0 MiB，根盘约 9.2 GiB 可用（69% 使用）；本地/远端传输 tar 已清理 |
| 2026-05-26 20:23 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:53b9c72c7dd8...` | 本机预构建镜像 tar（SHA256 `7b5b03a344263662ab7ad62c5e19dd2b7965498159da499c6a6b96ff2179aa65`）传输到 hk2 后 `docker load`，发布 commit `0cfc85f`：TeamRun supervisor dispatch 携带 structured output schema + TeamRun context，Edge Claude structured output 提升为 `run.agent.route_decision`，Desktop bridge 自动 POST route decision 到 Hub；无新 migration；服务器未执行 build；compose 状态备份 `/opt/agenthub-hub/hub-server/deployments/backups/ps_20260526_202320.txt`；保留 `rollback-before-route-binding-20260526-2023z` 回滚镜像 | 本地验证：Hub/Edge `go test ./... -short -count=1`、Desktop `corepack.cmd pnpm typecheck`、`useHubIntegration` Vitest 30/30、OpenAPI YAML 解析和 staged diff check 通过；部署态 Docker health `healthy`；本地/公网 `/health` migrations=37；未登录访问 TeamRunState endpoint 返回 401；Hub ~7.6 MiB、PG ~21.8 MiB、Redis ~2.7 MiB；根盘约 9.3 GiB 可用（68% 使用）；本地/远端传输 tar 已清理，旧 budget-timeout rollback 镜像已删除 |
| 2026-05-26 19:42 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:501db86de843...` | 本机预构建镜像 tar（SHA256 `f2517ce94574bac4d09bfc455ca574dbacbba03d0415f7e59162e8bf231d09db`）传输到 hk2 后 `docker load`，发布 AT-3 Hub guardrail 补强：route decision 接受前拦截 active assignment 超时、TeamRun runtime budget/token limit/usage percent 超限并写 `team.route.rejected`；无新 migration；服务器未执行 build；compose 状态备份 `/opt/agenthub-hub/hub-server/deployments/backups/ps_20260526_194250.txt`；保留 `rollback-before-budget-timeout-20260526-1940z` 回滚镜像 | Docker health `healthy`；本地/公网 `/health` migrations=37；未登录访问 TeamRunState endpoint 返回 401；Hub ~7.8 MiB、PG ~21.7 MiB、Redis ~2.7 MiB；根盘约 9.2 GiB 可用（69% 使用）；传输 tar 已清理，旧 approvals rollback 镜像已删除 |
| 2026-05-26 19:32 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:fc93676d794d...` | 本机预构建镜像 tar（SHA256 `ad758ef23f695ab57a0ff31c9e734da8a891fbb859e263b92db1c4d82fba13d8`）传输到 hk2 后 `docker load`，发布 TeamRunState approval/artifact summary projection：从 `run.agent.permission_requested` / `run.agent.permission_decided` 派生 approvals，并从 `run.agent.file_change` 派生 artifact/file-change 摘要；AT-2 后端 projection 闭环；无新 migration；服务器未执行 build；compose 状态备份 `/opt/agenthub-hub/hub-server/deployments/backups/ps_20260526_193234.txt`；保留 `rollback-before-approvals-20260526-1930z` 回滚镜像 | Docker health `healthy`；本地/公网 `/health` migrations=37；未登录访问 TeamRunState endpoint 返回 401；Hub ~7.6 MiB、PG ~21.3 MiB、Redis ~2.7 MiB；根盘约 9.2 GiB 可用（69% 使用）；传输 tar 已清理，旧 statebudget rollback 镜像已删除 |
| 2026-05-26 19:23 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:4ab08a930759...` | 本机预构建镜像 tar（SHA256 `da88bf647e59b063716ed8c0c18a05fd14775e55ce67ba38804c2a0c6a1d450b`）传输到 hk2 后 `docker load`，发布 TeamRunState `dependencies` + `budget` projection：从 TeamTask `parent_task_id` 派生 dependency edges，并从 `run.agent.result` / context usage events 汇总 token budget；无新 migration；服务器未执行 build；compose 状态备份 `/opt/agenthub-hub/hub-server/deployments/backups/ps_20260526_192322.txt`；保留 `rollback-before-statebudget-20260526-1921z` 回滚镜像 | Docker health `healthy`；本地/公网 `/health` migrations=37；未登录访问 TeamRunState endpoint 返回 401；Hub ~8.1 MiB、PG ~21.3 MiB、Redis ~2.7 MiB；根盘约 9.2 GiB 可用（69% 使用）；传输 tar 已清理，旧 runevents rollback 镜像已删除 |
| 2026-05-26 19:09 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:7fba1c34c427...` | 本机预构建镜像 tar（SHA256 `137186f9c9057e1404eb3a99858f936d0e6c84dff7560a74e2b9b3c5265d3851`）传输到 hk2 后 `docker load`，发布 TeamRunState `run_events` projection：按 TeamTask/Assignment 绑定的 Hub task id 合并 `agent_run_events` runtime 摘要；无新 migration；服务器未执行 build；compose 状态备份 `/opt/agenthub-hub/hub-server/deployments/backups/ps_20260526_190918.txt`；保留 `rollback-before-runevents-20260526-1908z` 回滚镜像 | Docker health `healthy`；本地/公网 `/health` migrations=37；未登录访问 TeamRunState endpoint 返回 401；Hub ~8.0 MiB、PG ~21.3 MiB、Redis ~2.7 MiB；根盘约 9.2 GiB 可用（69% 使用）；传输 tar 已清理，旧 guardrails rollback 镜像已删除 |
| 2026-05-26 18:54 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:00ab9aa27411...` | 本机预构建镜像 tar（SHA256 `5b8bf2e05345d565a282c3e49942c65bd9c7df7bd18f3ac2b1e459d40fab096b`）传输到 hk2 后 `docker load`，发布 AT-3 guardrails：`MAX_ACTIVE_SUBAGENTS_PER_RUN` 按 TeamRun 统计、`MAX_ROUTE_REPEATS` 重复 route 拦截、route rejection 审计原因；无新 migration；服务器未执行 build；compose 状态备份 `/opt/agenthub-hub/hub-server/deployments/backups/ps_20260526_185451.txt`；保留 `rollback-before-guardrails-20260526-1852z` 回滚镜像 | Docker health `healthy`；本地/公网 `/health` migrations=37；未登录访问 route-decisions POST 返回 401；Hub ~8.2 MiB、PG ~21.3 MiB、Redis ~2.7 MiB；根盘约 9.2 GiB 可用（69% 使用）；传输 tar 已清理，旧 dispatch-binding rollback 镜像已删除 |
| 2026-05-26 18:39 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:f136c606fea7...` | 本机预构建镜像 tar（SHA256 `7ff58790c1fd5e132cdbaafe51f7ef1fb2dd4a000fc893fa58bdba9eab8f9bcb`）传输到 hk2 后 `docker load`，发布 TeamRun supervisor trigger message 修复、Assignment dispatch → Hub pending task 真实绑定、TeamTask/Assignment `agent_task_id` / `edge_run_id` projection；无新 migration；服务器未执行 build；compose 状态备份 `/opt/agenthub-hub/hub-server/deployments/backups/ps_20260526_183936.txt`；保留 `rollback-before-dispatch-binding-20260526-1837z` 回滚镜像 | Docker health `healthy`；本地/公网 `/health` migrations=37；未登录访问 assignment dispatch POST 与 tasks endpoint 均返回 401；Hub ~7.8 MiB、PG ~21.3 MiB、Redis ~2.7 MiB；根盘约 9.2 GiB 可用（69% 使用）；传输 tar 已清理，旧 TeamTask rollback 镜像已删除 |
| 2026-05-26 18:16 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:8fbf4ae18632...` | 本机预构建镜像 tar（SHA256 `64e1ea3dc0cda444ab934f96596dc91e1116d69878ca2a5f8600ec6d32779a74`）传输到 hk2 后 `docker load`，发布 migration 0037、`agent_team_tasks` model/API/projection、owner-scoped `GET /web/agent-teams/{id}/runs/{run_id}/tasks`，accepted route decision 会同步创建 TeamAssignment + TeamTask 并写 `team.task.created`；预迁移备份 `/opt/agenthub-hub/hub-server/deployments/backups/agenthub-pg-pre-migration-0037-20260526T1810Z.sql.gz`（SHA256 `8206cdc52de3a01509541317ced63b798e4ba44989f5efa5415e338636d0aafa`）；服务器未执行 build；保留 `rollback-before-teamtasks-20260526-1813z` 回滚镜像 | Docker health `healthy`；本地/公网 `/health` migrations=37；未登录访问 tasks endpoint 返回 401；Hub ~9.0 MiB、PG ~21.4 MiB、Redis ~2.7 MiB；根盘约 9.2 GiB 可用（69% 使用）；传输 tar 已清理 |
| 2026-05-26 17:51 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:c7204543986d...` | 本机预构建镜像传输到 hk2，发布 owner-scoped `GET /web/agent-teams/{id}/runs/{run_id}/events` TeamEvent 读取 API；服务器未执行 build；保留 `rollback-before-events-api-20260526-1753z` 回滚镜像 | Docker health `healthy`；本地/公网 `/health` migrations=36；未登录访问 events endpoint 返回 401；Hub ~8 MiB、PG ~19 MiB、Redis ~5 MiB；根盘约 9.3 GiB 可用 |
| 2026-05-26 17:27 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:300cc8e8ddad...` | 本机预构建镜像传输到 hk2，发布 `POST /web/agent-teams/{id}/runs/{run_id}/route-decisions`、typed route accepted/rejected TeamEvent 审计和 TeamRun 任务总数 guardrail；服务器未执行 build；该版本后续作为 `rollback-before-events-api-20260526-1753z` 保留 | Docker health `healthy`；本地/公网 `/health` migrations=36；未登录访问 route decision endpoint 返回 401；Hub ~8 MiB、PG ~19 MiB、Redis ~3 MiB |
| 2026-05-26 16:59 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:919673032e59...` | 本机预构建镜像传输到 hk2，发布 TeamEvent append/list 与 TeamRunState replay API；服务器未执行 build | Docker health `healthy`；`/health` migrations=36；公网 `/health` OK；未登录访问 state route 返回 401 |
| 2026-05-26 16:40 | `ghcr.io/tokendancelab/agenthub-hub:latest` → `sha256:55c372b7041b...` | 本机预构建镜像传输到 hk2，升级到 commit `b77591d` 并执行 migration 0036 | Docker health `healthy`；`/health` migrations=36；公网 `/api/public/stats` OK |

## 与 AIhub 隔离

| 资源 | AIhub（已有） | AgentHub（新增） |
|:--|:--|:--|
| PostgreSQL | 宿主机 :5432 | Docker agenthub-postgres（容器内 :5432，不对外暴露） |
| Redis | 宿主机 :6379 | Docker agenthub-redis（容器内 :6379，不对外暴露） |
| 端口 | 8080（NewAPI）+ 其他 | 127.0.0.1:8090（仅 nginx 访问） |
