# Hub Server Deployments

最后更新：2026-07-16

本目录只保存 Hub Server 部署资产和本仓库可验证的部署边界。旧长版部署手册见 [../../docs/history.md](../../docs/history.md)。

Live host、DNS、TLS、secret、机器路径和发布状态不在本仓库维护；以 TokenDance server SSOT 为准。

## Authority (read first)

| Priority | Source |
|---|---|
| 1 Live ops | server `projects/agenthub/STATE.md` — **hk3 LIVE** |
| 2 In-repo production shape | `../../deployments/production/docker-compose.yml` |
| 3 This directory | Dockerfile + **historical** compose/nginx templates |

`docker-compose.prod.yml` / `hk2/` / `docker-compose.us1.yml` 描述的是**旧独立 PG+Redis 拓扑**，不是当前 Azure PG 生产形状。默认当作 historical reference。

## Files

| 文件 | 用途 |
|---|---|
| `Dockerfile` | Hub Server 镜像构建（仍可能被 CD 使用） |
| `docker-compose.prod.yml` | **Historical** standalone PG+Redis prod shape（非权威） |
| `docker-compose.us1.yml`, `hk2/` | 历史/环境模板；使用前必须核对 server SSOT |
| `nginx.prod.conf` | 反向代理参考配置（非权威） |
| `.env.production.example` | 生产环境变量占位模板，不含 secret |

## Required Runtime

| 组件 | 版本/边界 |
|---|---|
| Go | 1.25，用于开发机或 CI 构建 |
| PostgreSQL | 16 |
| Redis | 7 |
| Hub JWT secret | 环境注入，至少 32 字符 |
| TokenDance ID client secret | secret store 注入，不能写入 repo |
| Admin pprof/metrics | 独立 admin 端口 + Basic Auth + loopback/internal exposure |

## Local Shape Check

```powershell
docker compose config
pwsh ./scripts/verify/verify-oidc-readiness.ps1
```

`verify-oidc-readiness.ps1` 只检查仓库内配置形状和边界，不连接生产 TokenDance ID，也不证明真实登录。

## Production Boundary

生产发布需要独立批准和证据：

- 镜像构建与 digest。
- secret 注入和 OIDC client 注册。
- PostgreSQL/Redis 可用性。
- `/health`、CORS、WS upgrade、OIDC callback smoke。
- admin 端口不可公网访问。
- rollback 方案和备份状态。

未运行这些 gate 时，PR 只能声明配置/readiness 形状，不得写“生产已验证”。
