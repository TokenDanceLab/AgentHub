# Deployment

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-06-10

## 概述

AgentHub 当前阶段以 hk2 为主要生产部署节点。Desktop 本地不部署 Hub；Web 访问 Hub 经 Nginx 反向代理。

## hk2 部署

hk2 是当前主要的生产 Host，运行：

- AgentHub Hub Server
- AgentHub Edge Server
- Nginx 反向代理
- PostgreSQL（shared）
- Redis（shared）

## 项目结构

```text
app/desktop/
  src-tauri/src/host/     Tauri host capability modules
    mod.rs
    edge.rs               Edge start/stop/status/auth token
    fs.rs                 文件树、读写、allowlist
    dialog.rs             文件/目录选择
    auth.rs               OIDC loopback、session/keyring
    window.rs             窗口、托盘、通知
    system.rs             平台信息、诊断
  src-tauri/src/commands.rs   register_commands() + migration shims

hub-server/               Hub 服务端应用

edge-server/              可独立部署的 Edge 服务端应用
```

## Docker Compose

当前部署使用 Docker Compose 管理多容器：

- `hub-server` 容器
- `edge-server` 容器
- PostgreSQL 容器
- Redis 容器
- Nginx 容器

## Nginx

Nginx 负责：

- 前端静态文件服务（Desktop `5173`、Web `5174`、design demo `5176`）
- Hub API 反向代理
- WebSocket 升级（用于实时事件推送）
- SSL 终止

## SSL

生产使用泛域名证书（Let's Encrypt wildcard），Nginx 层处理 SSL 终止，内网容器间 HTTP 明文通信。

## 环境变量

桌面端开发端口规范：

| 端 | 端口 | 说明 |
|---|---|---|
| Desktop/Tauri 前端 | `5173` | Vite dev server |
| Web 前端 | `5174` | Vite dev server |
| Mobile (Expo) | 动态 | Expo + React Native |
| 浏览器视觉预览 | `5177` | 避免抢占 Desktop/Web/design demo 端口 |

Design demo 端口：

| Demo | 端口 |
|---|---|
| `agenthub-design/desktop/` | `5176/desktop` |

## 开发环境

本地开发：

```bash
# Desktop
cd app/desktop && npm run dev

# Web
cd app/web && npm run dev

# Edge Server
cd edge-server && go run .

# Hub Server
cd hub-server && go run .
```

## 相关文档

- [02-edge-server.md](02-edge-server.md) — Edge Server 独立部署细节
- [01-hub-server.md](01-hub-server.md) — Hub Server 部署依赖（PostgreSQL、Redis）
