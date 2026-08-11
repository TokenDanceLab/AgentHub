# Hub Server Deployments

最后更新：2026-08-03（#1527 PR2）

本目录只保存 Hub Server **镜像构建输入**。旧区域部署 compose、deploy.sh 系列脚本、
Caddy/nginx 反代模板与 env 模板已在 #1527 PR2 收口删除，历史参考以 TokenDance server SSOT 为准。

Live host、DNS、TLS、secret、机器路径和发布状态不在本仓库维护；以 TokenDance server SSOT 为准。

## Authority (read first)

| Priority | Source |
|---|---|
| 1 Live ops | server `projects/agenthub` external ops SSOT — **LIVE** |
| 2 In-repo production shape | `../../deployments/production/docker-compose.yml`（唯一权威 compose） |
| 3 This directory | Dockerfile + docker-entrypoint.sh（构建输入） |

## Files

| 文件 | 用途 |
|---|---|
| `Dockerfile` | Hub Server 镜像构建输入（cd-hub-server / cd-production 消费，构建上下文为仓库根） |
| `docker-entrypoint.sh` | 镜像 ENTRYPOINT（容器启动时校验必需 secret，Dockerfile COPY 自构建上下文） |
| `README.md` | 本说明 |

## Build

```bash
docker build -f hub-server/deployments/Dockerfile .
# 或 CI（cd-pr-check / cd-production）：
# docker build -t ghcr.io/tokendancelab/agenthub-hub-server:<tag> \
#   -f hub-server/deployments/Dockerfile .
```

## Deploy

人工部署按 `deployments/production/docker-compose.yml` 执行，不在此目录。

## Production Boundary

生产发布需要独立批准和证据：

- 镜像构建与 digest。
- secret 注入和 OIDC client 注册。
- PostgreSQL/Redis 可用性。
- `/health`、CORS、WS upgrade、OIDC callback smoke。
- admin 端口不可公网访问。
- rollback 方案和备份状态。

未运行这些 gate 时，PR 只能声明配置/readiness 形状，不得写"生产已验证"。
