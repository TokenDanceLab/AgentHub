# Deployment

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-08-03

本文件只记录仓库内可维护的部署结构和证据边界。Live host、DNS、TLS、secret、机器路径、发布状态和生产回滚记录由 TokenDance server SSOT 维护，不在本仓库复制。

## Current production pointer

- **Live facts（权威）**：外部 server `projects/agenthub/STATE.md`（运维 SSOT）。本仓库不复制 host 标签、secret 或 IP。
- **In-repo production shape**：`deployments/production/docker-compose.yml`（与 live compose 形状对齐的仓库模板）。
- **构建输入目录**：`hub-server/deployments/` 仅保留镜像构建输入（Dockerfile、docker-entrypoint.sh、README.md），旧 prod/us1/hk2 compose 与 deploy 脚本已在 #1527 PR2 收口删除。

## 仓库内资产（#1527 inventory）

| 资产 | 用途 | 状态 |
|---|---|---|
| `docker-compose.yml` | 本地开发：PostgreSQL、Redis、Hub Server | local-development shape（#1527 明确不删） |
| `deployments/production/docker-compose.yml` | 当前生产形状 compose 模板 | **权威 in-repo production shape**（唯一） |
| `deployments/production/.env.example` | 权威生产 env 占位模板（含 OIDC 回调/交换端点说明） | 保留 |
| `hub-server/deployments/Dockerfile` | Hub Server 镜像构建输入 | 保留（构建职责） |
| `hub-server/deployments/docker-entrypoint.sh` | 镜像 ENTRYPOINT（Dockerfile COPY 的构建输入） | 保留（构建职责） |
| `hub-server/deployments/README.md` | 构建输入目录说明 | 保留（#1527 PR2 精简） |
| `hub-server/deployments/docker-compose.prod.yml` | 旧独立 PG+Redis 拓扑模板 | **已删除**（#1527 PR2 收口） |
| `hub-server/deployments/docker-compose.us1.yml` | 区域（us1）旧模板 | **已删除**（#1527 PR2 收口） |
| `hub-server/deployments/hk2/`（compose、deploy 脚本、nginx/env 模板） | 区域（hk2）旧部署资产 | **已删除**（#1527 PR2 收口） |
| `hub-server/deployments/Caddyfile` / `Caddyfile.prod` | 旧 reverse-proxy 模板 | **已删除**（#1527 PR2 收口） |
| `hub-server/deployments/.env.production.example` | 旧生产 env 占位模板 | **已删除**（env 说明迁至 `deployments/production/.env.example`） |
| `hub-server/deployments/deploy.sh` / `hk2/deploy-hk2.sh` / `deploy-web-hk2.sh` | 旧人工运维胶水脚本 | **已删除**（部署指引改指权威 compose，运维由 server SSOT 覆盖） |
| `scripts/verify/verify-deployment-shape.py` | 部署形状 SSOT 门禁 | CI 强制（#1527 PR1） |
| `.github/workflows/cd-pr-check.yml` | PR 前置：compose 形状 + Dockerfile + 构建 dry run | 消费权威模板（#1527 PR1） |

遗留清单由 `verify-deployment-shape.py` 关闭：#1527 PR2 后 `hub-server/deployments/` 下出现**任何** compose 文件即 FAIL（该目录只剩构建输入）；`deployments/production/` 下出现第二份手维护 production compose 同样 FAIL——机器证明见 `scripts/verify/tests/verify-deployment-shape.Tests.ps1`。

## 本地开发

```powershell
docker compose up -d
```

默认端口：

| 服务 | 端口 |
|---|---:|
| Hub API | 8080 |
| Hub admin / pprof / metrics | 6060 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| Desktop/Tauri Vite | 5173 |
| Web Vite | 5174 |
| Mobile RN Expo Web | 5177 |
| Local Edge | 3210 |

默认 compose 绑定开发本机；远程调试必须显式配置网络和防火墙，不能把默认开发密码或 admin 端口暴露出去。

## 部署证据等级

| Claim | 最低证据 |
|---|---|
| Compose 配置形状正确 | `docker compose config` 或 CI compose check |
| OIDC 配置形状正确 | OIDC/session tests（`verify-oidc-readiness.py` 已 KNOWN-OBSOLETE，见 `AGENTS.md` §9.5） |
| Hub/Edge API 行为正确 | 相关 Go handler/service tests + OpenAPI parse |
| Web/Desktop UI 流程正确 | Playwright UI + Visual QA，按证据等级标注 |
| Desktop packaged 行为正确 | Tauri package/sidecar/icon/installer evidence |
| 生产发布正确 | 外部 approved-real 发布 gate + live smoke + rollback evidence |

Stub、fixture、readiness-only 或 dry-run 证据必须保留 `real_tested=false`。

## 生产边界

生产发布不由本仓库 Markdown 单独证明。发布前至少需要：

- 明确审批。
- 镜像 digest、部署命令、rollback 方案和备份状态。
- secret store 注入，不把 secret 写进 repo。
- `/health`、CORS、OIDC callback、WebSocket upgrade 和 admin exposure smoke。
- 若声明 Desktop packaged/release，附 packaged-release gate；Vite renderer 测试不等同于 packaged Desktop。

## 相关文档

- [01-hub-server.md](01-hub-server.md) — Hub Server 架构
- [02-edge-server.md](02-edge-server.md) — Edge Server 架构
- [06-auth-identity.md](06-auth-identity.md) — TokenDance ID 和 Hub session
- [../../AGENTS.md](../../AGENTS.md) — 执行 gate 和项目规则
- [../../.agents/skills/real-e2e-acceptance/SKILL.md](../../.agents/skills/real-e2e-acceptance/SKILL.md) — 真实 E2E 证据等级
