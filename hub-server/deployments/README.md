# Hub Server 部署指南

## 前置条件

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| Go | 1.25 | 构建所需 |
| PostgreSQL | 16 | 主数据库 |
| Redis | 7 | 缓存 / 会话 / WebSocket 路由 |

## 环境变量

Hub Server 通过 `AGENTHUB_` 前缀的环境变量覆盖配置文件中的值。以下是全部可用变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AGENTHUB_SERVER_PORT` | HTTP 服务端口 | `8080` |
| `AGENTHUB_SERVER_LOG_LEVEL` | 日志级别 (`debug` / `info`) | `info` |
| `AGENTHUB_SERVER_LOG_FILE` | 日志文件路径（空 = stdout） | `` |
| `AGENTHUB_SERVER_ADMIN_PORT` | pprof + metrics 端口 | `6060` |
| `AGENTHUB_DB_HOST` | PostgreSQL 主机 | `localhost` |
| `AGENTHUB_DB_PORT` | PostgreSQL 端口 | `5432` |
| `AGENTHUB_DB_USER` | PostgreSQL 用户 | `agenthub` |
| `AGENTHUB_DB_PASSWORD` | PostgreSQL 密码 | **必填** |
| `AGENTHUB_DB_NAME` | PostgreSQL 库名 | `agenthub` |
| `AGENTHUB_REDIS_HOST` | Redis 主机 | `localhost` |
| `AGENTHUB_REDIS_PORT` | Redis 端口 | `6379` |
| `AGENTHUB_REDIS_PASSWORD` | Redis 密码 | `` |
| `AGENTHUB_REDIS_DB` | Redis 数据库编号 | `0` |
| `AGENTHUB_REDIS_POOL_SIZE` | Redis 连接池大小 | `100` |
| `AGENTHUB_REDIS_MIN_IDLE_CONNS` | Redis 最小空闲连接 | `10` |
| `AGENTHUB_JWT_SECRET` | JWT 签名密钥（**必填，最少 16 字符**） | — |
| `AGENTHUB_JWT_ACCESS_TTL` | Access Token 有效期 | `15m` |
| `AGENTHUB_JWT_REFRESH_TTL` | Refresh Token 有效期 | `720h` |
| `AGENTHUB_TOKENDANCE_ID_ISSUER_URL` | TokenDance ID issuer，用于 RS256 bearer-token 兼容路径 | `https://id.vectorcontrol.tech` |
| `AGENTHUB_TOKENDANCE_ID_JWKS_URI` | TokenDance ID JWKS；为空时由 issuer 拼出 `/oidc/jwks` | `https://id.vectorcontrol.tech/oidc/jwks` |
| `AGENTHUB_TOKENDANCE_ID_CLIENT_ID` | Hub OIDC client id；启用 TokenDance bearer 兼容路径时必填，用于强制 `aud` 校验 | — |
| `AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET` | 预留给未来 confidential-client flow；只从 secret store 注入 | — |
| `AGENTHUB_UPLOAD_DIR` | 上传文件存储目录 | `./uploads` |
| `AGENTHUB_UPLOAD_MAX_SIZE` | 上传文件最大字节数 | `10485760` |
| `AGENTHUB_PPROF_USER` | 管理端点 HTTP Basic 用户名 | **必填** |
| `AGENTHUB_PPROF_PASS` | 管理端点 HTTP Basic 密码 | **必填** |

`AGENTHUB_JWT_SECRET` 必须通过环境变量设置；配置文件中的硬编码默认值会被拒绝。参见 `.env.example`。

TokenDance ID 相关变量只启用 Hub Server 对 TokenDance ID RS256 bearer token 的兼容校验路径。启用该路径时必须配置 issuer、JWKS 和 Hub client id；Hub 会校验 RS256 签名、`exp`、`iss` 和 `aud`。当前 Hub Server 还没有最终定稿的 TokenDance ID 浏览器登录 callback，也不会为 TokenDance ID bearer token 自动创建 Hub refresh session；完整边界见 `../README.md` 的 TokenDance ID 兼容鉴权章节。

## 快速启动（Docker Compose）

开发环境 compose 位于仓库根目录 `docker-compose.yml`，会启动 PostgreSQL 16、Redis 7 和 Hub Server。

```powershell
# 在 AgentHub 仓库根目录
copy .env.example .env
docker compose up -d
```

生产部署参考 `deployments/docker-compose.prod.yml`，镜像构建入口为 `deployments/Dockerfile`。

## 生产部署

### 方案 A：二进制 + systemd

```powershell
# 1. 构建
cd hub-server
go build -ldflags="-s -w -X 'github.com/agenthub/hub-server/internal/app.Version=1.0.0'" -o /usr/local/bin/hub-server ./cmd/server-hub

# 2. 配置文件
mkdir -p /etc/hub-server /var/log/hub-server /var/lib/hub-server/uploads
cp configs/config.yaml /etc/hub-server/config.yaml
# 编辑 /etc/hub-server/config.yaml 填入生产环境地址

# 3. 环境变量
cat > /etc/hub-server/env <<'EOF'
AGENTHUB_JWT_SECRET=<生成一个 32+ 字符的随机密钥>
AGENTHUB_DB_PASSWORD=<数据库密码>
AGENTHUB_PPROF_USER=admin
AGENTHUB_PPROF_PASS=<管理端点密码>
EOF

# 4. systemd unit
cat > /etc/systemd/system/hub-server.service <<'EOF'
[Unit]
Description=AgentHub Hub Server
After=network.target postgresql.service redis.service
Wants=postgresql.service redis.service

[Service]
Type=simple
User=agenthub
EnvironmentFile=/etc/hub-server/env
ExecStart=/usr/local/bin/hub-server
WorkingDirectory=/etc/hub-server
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now hub-server
```

### 方案 B：Docker 单容器

```powershell
# 构建镜像
docker build -f deployments/Dockerfile -t hub-server:latest .

# 运行
docker run -d \
  --name hub-server \
  --restart always \
  -p 8080:8080 \
  -e AGENTHUB_DB_HOST=<数据库主机> \
  -e AGENTHUB_DB_PASSWORD=<数据库密码> \
  -e AGENTHUB_REDIS_HOST=<Redis 主机> \
  -e AGENTHUB_JWT_SECRET=<JWT 密钥> \
  -e AGENTHUB_PPROF_USER=admin \
  -e AGENTHUB_PPROF_PASS=<管理密码> \
  -v /var/log/hub-server:/var/log/hub-server \
  hub-server:latest
```

## 反向代理

### Caddy

```caddy
hub.example.com {
    reverse_proxy localhost:8080
    header / {
        X-Forwarded-Proto https
    }
}
```

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name hub.example.com;

    ssl_certificate     /etc/ssl/hub.example.com.crt;
    ssl_certificate_key /etc/ssl/hub.example.com.key;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 升级
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 备份与恢复

### 数据库备份

```powershell
# 全量导出
pg_dump -h <host> -U agenthub -Fc agenthub > hub-server-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump

# 定时备份 (crontab / Task Scheduler)
# 每日凌晨 2:00 备份，保留 7 天
0 2 * * * pg_dump -h localhost -U agenthub -Fc agenthub > /backup/hub-server-$(date +\%Y\%m\%d).dump && find /backup -name 'hub-server-*.dump' -mtime +7 -delete
```

### 数据库恢复

```powershell
# 1. 停止服务
systemctl stop hub-server

# 2. 恢复
pg_restore -h <host> -U agenthub -d agenthub --clean --if-exists hub-server-20260524.dump

# 3. 重新启动服务，启动过程会自动执行缺失迁移
cd hub-server && go run ./cmd/server-hub

# 4. 启动服务
systemctl start hub-server
```

### Redis 备份

Redis 通过 `--save` 参数自动持久化。Docker 部署中配置为 `--save 60 1`（60 秒内至少 1 个 key 变化则保存）。如需手动备份：

```powershell
docker exec <redis-container> redis-cli BGSAVE
```

## 健康检查监控

`GET /health` 端点供负载均衡器和 uptime 监控使用，无需认证。

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": "2h34m",
  "checks": {
    "database": "ok",
    "redis": "ok",
    "migrations": {
      "version": 17,
      "dirty": false
    }
  }
}
```

字段说明：
- `status`: `ok` 表示所有组件正常，`degraded` 表示至少一个组件异常
- `version`: 构建版本（通过 `-ldflags` 注入，未设置时显示 `dev`）
- `uptime`: 服务运行时长
- `checks.database`: PostgreSQL 连接状态
- `checks.redis`: Redis 连接状态
- `checks.migrations`: 当前迁移版本号；`dirty=true` 时标记迁移脏状态

Docker 内置 health check：
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1
```

Kubernetes liveness/readiness probe：
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 30
readinessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
```

## 日志配置

日志通过 `AGENTHUB_SERVER_LOG_LEVEL` 和 `AGENTHUB_SERVER_LOG_FILE` 控制。

| 配置 | 值 | 说明 |
|------|-----|------|
| `log_level: debug` | 调试模式 | 输出所有日志，禁用 Gin Release 模式 |
| `log_level: info` | 生产模式 | 仅输出 info 及以上级别 |
| `log_file: ""` | 空字符 | 输出到 stdout（Docker / systemd 推荐） |
| `log_file: /var/log/hub-server/server.log` | 文件路径 | 带自动轮转（10MB / 保留 5 个 / 最多 30 天） |

结构化日志格式（slog JSON handler）：
```json
{"time":"2026-05-24T10:30:00Z","level":"INFO","msg":"server starting","port":8080}
```

## 迁移管理

Hub Server 启动时自动执行 `migrations/` 下的待执行迁移。当前 `cmd/server-hub` 没有单独的 `migrate up/down` 子命令；需要回滚时使用数据库备份恢复或手动执行对应 down SQL，并在恢复后重启服务确认 `/health` 中的迁移状态。
