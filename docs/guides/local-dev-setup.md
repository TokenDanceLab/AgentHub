# AgentHub 本地开发指南

## 前置要求

- Go 1.25+
- Node.js 20+ / pnpm 9+
- PostgreSQL 15+（推荐 16）
- Redis 7+
- Docker & Docker Compose（可选，用于启动 Hub 依赖）

## 快速开始

### 1. 克隆仓库

```bash
git clone git@github.com:TokenDanceLab/AgentHub.git
cd AgentHub
git checkout dev/delicious233
```

### 2. 配置环境变量

```bash
# 首次使用复制示例配置
cp hub-server/.env.example hub-server/.env
# 然后编辑 hub-server/.env，根据本地环境修改数据库密码等
```

`.env.example` 已包含本地开发的合理默认值，大部分配置无需修改即可使用。

### 3. 启动基础设施（PostgreSQL + Redis）

**方式 A：Docker Compose（推荐）**

```bash
# 启动全部服务（PostgreSQL + Redis + Hub Server）
docker compose up -d

# 或者仅启动基础设施，手动运行 Hub Server
docker compose up -d postgres redis
```

PostgreSQL 默认配置：
- 数据库名：`agenthub`
- 用户名：`agenthub`
- 密码：`dev_password`（本地开发用）
- 端口：`5432`（仅绑定 `127.0.0.1`）

Redis 默认配置：
- 端口：`6379`（仅绑定 `127.0.0.1`）
- 持久化：AOF + RDB，最大内存 256MB

**方式 B：使用已有实例**

如果已有 PostgreSQL 和 Redis 在运行，在 `hub-server/.env` 中修改 `AGENTHUB_DB_HOST`、`AGENTHUB_DB_PORT`、`AGENTHUB_REDIS_HOST`、`AGENTHUB_REDIS_PORT` 指向你的实例。

### 4. 启动 Hub Server

```bash
cd hub-server
go run ./cmd/server-hub
```

Hub Server API：`http://127.0.0.1:8080`
管理/指标端口：`http://127.0.0.1:6060`

### 5. 启动 Edge Server

```bash
cd edge-server
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210
```

Edge Server API：`http://127.0.0.1:3210`

### 6. 启动 Desktop 开发服务器

```bash
cd app/desktop
pnpm install          # 首次
pnpm dev              # 开发模式
pnpm dev --port 5199  # 指定端口
```

Desktop 开发入口：`http://localhost:5173`

### 7. 启动 Web（可选）

```bash
cd app/web
pnpm install          # 首次
pnpm dev              # 开发模式
```

Web 开发入口：`http://localhost:5175`

### 一键启动

项目提供了启动脚本，一键启动 Edge + Hub + Desktop：

```bash
# Windows PowerShell
.\scripts\dev-start.ps1

# Unix / macOS
./scripts/dev-start.sh
```

脚本会：
1. 检查 go/node/pnpm 是否安装
2. 自动安装 desktop 依赖（首次）
3. 后台启动 edge-server、hub-server、desktop
4. 等待各服务端口就绪
5. Ctrl+C 时优雅关闭所有服务

## 端口分配

| 服务 | 端口 | 说明 |
|------|------|------|
| Hub Server API | 8080 | REST + WebSocket API |
| Hub Server Admin | 6060 | pprof 指标 |
| Edge Server | 3210 | 本地执行节点 |
| Desktop Vite | 5173 | 桌面客户端开发服务器 |
| Mobile Vite | 5174 | 移动端开发服务器 |
| Web Vite | 5175 | Web 工作台开发服务器 |
| Storybook | 6006 | UI 组件文档 |
| PostgreSQL | 5432 | 默认仅绑定 127.0.0.1 |
| Redis | 6379 | 默认仅绑定 127.0.0.1 |

## 验证各服务

```bash
# Hub Server 健康检查
curl http://127.0.0.1:8080/health

# Edge Server 健康检查
curl http://127.0.0.1:3210/health

# 运行完整测试套件
cd edge-server && go test ./... -short -count=1
cd ../hub-server && go test ./... -short -count=1
cd ../app/desktop && pnpm test && pnpm typecheck && pnpm build
```

## OIDC 登录测试

AgentHub 使用 TokenDance ID 统一登录。本地开发时：

1. 启动 TokenDance ID（如可用）：
   ```bash
   cd ../tokendance-id && go run ./cmd/tokendance-id
   ```

2. 运行 OIDC 设置脚本：
   ```bash
   # 在 AgentHub 仓库根目录
   bash scripts/setup-tokendance-oidc.sh
   ```

3. 或在 `hub-server/.env` 中手动配置 OIDC 变量：
   - `AGENTHUB_TOKENDANCE_ID_ISSUER_URL` — TokenDance ID 地址（默认 `http://localhost:3000`）
   - `AGENTHUB_TOKENDANCE_ID_CLIENT_ID` — OAuth 客户端 ID
   - `AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET` — OAuth 客户端密钥
   - `AGENTHUB_TOKENDANCE_ID_REDIRECT_URI` — 回调地址

4. 也可使用种子数据（TokenDance ID 未运行时）：
   ```bash
   sqlite3 ../tokendance-id/data/tokendance.db < scripts/seed-tokendance-client.sql
   ```
   种子数据使用 `client_id=agenthub-desktop`，`secret=agenthub-dev-secret-change-me`

Desktop OIDC callback 通过 Tauri 启动本地临时 HTTP server（`127.0.0.1:0` 动态端口），不走固定端口。

## 常见问题

### 编译错误 `missing go.sum entry`

```bash
go mod tidy
```

### 端口被占用

```bash
# Windows
netstat -ano | findstr :8080
# 或者修改 .env 中的 AGENTHUB_SERVER_PORT

# Unix
lsof -i :8080
```

### PostgreSQL 连接失败

确认 Docker Compose 已启动：
```bash
docker compose ps postgres
```
确认 `hub-server/.env` 中的 `AGENTHUB_DB_HOST=localhost`（不是 `postgres`，那是 Docker 内部网络用的）。

### Redis 连接失败

同上，确认 `hub-server/.env` 中 `AGENTHUB_REDIS_HOST=localhost`。

### Docker Compose 中 Hub Server 端口冲突

Docker Compose 中 Hub Server 默认也绑定 8080 和 6060。如果想用 `go run` 启动 Hub，先在 `docker-compose.yml` 中注释掉 `hub-server` 服务，或只启动基础设施：

```bash
docker compose up -d postgres redis
```

### pnpm 安装失败

确认 Node.js >= 20 且 corepack 已启用：
```bash
corepack enable
corepack prepare pnpm@9 --activate
```

Windows 上如遇到 corepack 生命周期问题，可使用：
```powershell
corepack.cmd pnpm install --frozen-lockfile
```
