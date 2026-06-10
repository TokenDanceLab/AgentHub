# Deployment

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-06-10

## 概述

AgentHub 当前阶段以 hk2 为主要生产部署节点。

## hk2 生产部署

生产 Hub Server 部署在 hk2（核云 VPS，香港），公开地址 `https://hub.vectorcontrol.tech`。

**技术栈**：Docker Compose + Nginx + Let's Encrypt SSL

### Docker Compose 服务

配置文件：`hub-server/deployments/hk2/docker-compose.hk2.yml`

| 服务 | 镜像 | 资源限制 | 端口 |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 512MB / 1 CPU | 5432（内部） |
| `redis` | `redis:7-alpine` | 384MB / 0.5 CPU | 6379（内部） |
| `hub-server` | `ghcr.io/tokendancelab/agenthub-hub:latest` | 256MB / 1 CPU | 8090→8080（loopback only） |

### Nginx 配置

配置文件：`hub-server/deployments/hk2/nginx-hk2.conf`

| Location | 认证 | 后端 |
|---|---|---|
| `/health` | 无 | Hub backend |
| `/api/*` | OAuth2-proxy | Hub backend |
| `/client/*` | OAuth2-proxy | Hub backend |
| `/client/ws` | OAuth2-proxy | Hub backend（WebSocket upgrade, 3600s timeout） |
| `/auth/tokendance/*` | 无 | Hub backend（OIDC callback） |
| `/oauth2/*` | 无 | oauth2-proxy @ 127.0.0.1:4181 |
| `/` | 无 | 静态主页（Astro export） |

### SSL 与安全

- SSL：使用 `api.vectorcontrol.tech` 通配符证书（certbot HTTP-01）
- `agenthub.vectorcontrol.tech` 301 重定向到 `hub.vectorcontrol.tech`
- HTTP -> HTTPS 重定向
- Rate limiting：API 200r/m、Auth 10r/m
- 安全头：X-Frame-Options DENY、HSTS preload、CSP

### 网络

- Docker 网络：`agenthub-net`（172.18.0.0/16 bridge），与 aihub-hk2 网络隔离
- 日志：JSON file driver，10MB max / 3 files rotation
- DNS：`hub.vectorcontrol.tech` A record 指向 hk2 公网 IP

## 开发环境

开发 Docker Compose（根目录 `docker-compose.yml`）提供相同技术栈但：

- 默认绑定 `127.0.0.1`，避免开发密码暴露
- Hub Server 从本地 Dockerfile 构建（`hub-server/deployments/Dockerfile`）
- PostgreSQL / Redis 密码使用开发默认值
- 端口：Hub API 8080、Admin 6060、PostgreSQL 5432、Redis 6379

## 开发端口规范

| 端 | 端口 | 说明 |
|---|---|---|
| Desktop/Tauri 前端 | `5173` | Vite dev server |
| Web 前端 | `5174` | Vite dev server |
| Mobile (Expo) | 动态 | Expo + React Native |
| 浏览器视觉预览 | `5177` | 避免抢占 Desktop/Web/design demo 端口 |

Design demo 端口：

| Demo | 端口 |
|---|---|
| `tokendance-design/desktop/` | `5176/desktop` |

## 相关文档

- [02-edge-server.md](02-edge-server.md) — Edge Server 独立部署细节
- [01-hub-server.md](01-hub-server.md) — Hub Server 部署依赖（PostgreSQL、Redis）
- [06-auth-identity.md](06-auth-identity.md) — OIDC callback 与 Nginx 路由
