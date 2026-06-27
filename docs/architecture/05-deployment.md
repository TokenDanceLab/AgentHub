# Deployment

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-06-27

本文件只记录仓库内可维护的部署结构和证据边界。Live host、DNS、TLS、secret、机器路径、发布状态和生产回滚记录由 TokenDance server SSOT 维护，不在本仓库复制。

## 仓库内资产

| 资产 | 用途 |
|---|---|
| `docker-compose.yml` | 本地开发：PostgreSQL、Redis、Hub Server |
| `hub-server/deployments/Dockerfile` | Hub Server 镜像构建 |
| `hub-server/deployments/docker-compose.prod.yml` | 生产形状 compose 模板 |
| `hub-server/deployments/nginx.prod.conf` | Nginx reverse proxy 参考 |
| `hub-server/deployments/.env.production.example` | 生产 env 占位模板 |
| `.github/workflows/` | CI、构建、E2E、vuln scan、cross-platform gates |

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
| OIDC 配置形状正确 | `pwsh ./scripts/verify-oidc-readiness.ps1` |
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
