# AgentHub Hub Server — 生产部署记录

最后更新：2026-05-24

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
| `agenthub-hub` | 本地构建（golang:1.25 → alpine:3.21） | 127.0.0.1:8090:8080 | `agenthub_uploads` |

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

# 部署
cd hub-server
source deployments/.env.production
sudo -E docker compose -f deployments/docker-compose.prod.yml up -d --build hub-server

# 查看日志
sudo docker compose -f deployments/docker-compose.prod.yml logs -f hub-server

# 健康检查
curl http://localhost:8090/health
curl http://api.hub.vectorcontrol.tech/health

# 公开统计
curl http://api.hub.vectorcontrol.tech/api/public/stats
```

## 与 AIhub 隔离

| 资源 | AIhub（已有） | AgentHub（新增） |
|:--|:--|:--|
| PostgreSQL | 宿主机 :5432 | Docker agenthub-postgres（容器内 :5432，不对外暴露） |
| Redis | 宿主机 :6379 | Docker agenthub-redis（容器内 :6379，不对外暴露） |
| 端口 | 8080（NewAPI）+ 其他 | 127.0.0.1:8090（仅 nginx 访问） |
