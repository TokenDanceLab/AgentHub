# Hub Server Deployments

本目录只保存 Hub Server 镜像构建输入；生产 compose 在
`deployments/production/docker-compose.yml`，真实部署环境由运维方维护。

## Files

| 文件 | 用途 |
|---|---|
| `Dockerfile` | 镜像构建输入（构建上下文为仓库根） |
| `docker-entrypoint.sh` | 容器入口，启动时校验必需环境变量 |

## Build

```bash
docker build -f hub-server/deployments/Dockerfile .
```

## Deploy

按 `deployments/production/docker-compose.yml` 启动。发布前确认必需 secret 已注入、
OIDC client 已注册，并检查 `/health`、CORS、WS upgrade 和 OIDC callback。
