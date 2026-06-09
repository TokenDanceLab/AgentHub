# AgentHub Hub Server — hk2 Deployment Runbook

最后更新：2026-06-10

## Overview

| Item | Value |
|------|-------|
| Host | hk2 (核云 VPS, Hong Kong) |
| Public URL | https://hub.vectorcontrol.tech |
| Alias | agenthub.vectorcontrol.tech (301 to canonical) |
| Deploy path | `/opt/agenthub-hub/hub-server/deployments/hk2/` |
| Docker network | `agenthub-net` (172.18.0.0/16), isolated from `aihub-hk2` |
| Hub listen | `127.0.0.1:8090` (loopback only, nginx proxied) |
| OIDC issuer | `https://id.vectorcontrol.tech` (TokenDance ID) |
| oauth2-proxy | `127.0.0.1:4181` on hk2 |

## hk2 Server Environment

| Resource | Details |
|----------|---------|
| Provider | 核云 (VPS) |
| OS | Linux (Docker-based workloads) |
| Root disk | ~29G (usage ~63%, free ~11G as of 2026-06-09) |
| Docker | Installed, running |
| nginx | Installed, managing TLS reverse proxy |
| certbot | HTTP-01 challenge, `api.vectorcontrol.tech` cert covers hub subdomain |
| Tailnet | `100.113.6.26` |

### Running Services on hk2

- TokenDance Gateway (NewAPI) on `:3017`
- PostgreSQL (AIhub stack)
- Redis (AIhub stack)
- MetAPI, Codex2API, proxy-gateway (mihomo), oauth2-proxy
- tokendancechat, get-token, gemini-web2api
- **AgentHub** (hub-server + PG + Redis) — independent network

### Key Constraints

1. **Disk space is P1**: >=80% usage or <6G free requires capacity governance before any deploy.
2. **No `docker system prune -af`**: Only `docker image prune -f` allowed.
3. **nginx snapshots**: Run `sudo /usr/local/bin/nginx-snapshot` before editing nginx config on hk2.
4. **Post-deploy verification**: Must verify container, application, security, and DR layers after any change.
5. **agenthub service account**: Has root-equivalent permissions (P0 hardening item). Do not modify without coordinating command whitelist.

## Architecture

```
Internet → Cloudflare DNS → hk2 public IP
  → nginx (443/TLS, hub.vectorcontrol.tech)
    → /              static homepage (/opt/.../agenthub-home/out/)
    → /api/*         oauth2-proxy auth → hub-server (:8090)
    → /client/ws     oauth2-proxy auth → hub-server (WebSocket)
    → /client/*      oauth2-proxy auth → hub-server
    → /health        direct → hub-server (unauthenticated)
    → /auth/*        direct → hub-server (OIDC flow)
    → /oauth2/*      oauth2-proxy

Docker: agenthub-net (172.18.0.0/16)
  ├── agenthub-hub      (:8080 → host :8090)
  ├── agenthub-postgres (:5432 internal only)
  └── agenthub-redis    (:6379 internal only)
```

## Prerequisites

### On Development/CI Machine

- Go 1.25+ for building
- Docker for building images
- SSH access to hk2 (via hk1 jumpbox or direct)

### On hk2

- Docker + Docker Compose plugin (or docker-compose)
- nginx with SSL certs for `hub.vectorcontrol.tech`
- oauth2-proxy running with TokenDance ID issuer
- `.env.hk2` configured with all required secrets
- Network: `agenthub-net` (created by compose if not exists)

### SSH Configuration

```ssh-config
Host hk2
    HostName <hk2-public-ip>
    User ding
    IdentityFile ~/.ssh/id_ed25519
    # ProxyJump hk1  # if hopping through hk1
```

## Deployment Procedure

### Step 1: Build and Transfer Image

```bash
# On development machine
cd D:/Code/TokenDance/AgentHub

# Build Docker image
docker build -f hub-server/deployments/Dockerfile \
  -t ghcr.io/tokendancelab/agenthub-hub:$(git rev-parse --short HEAD) .

# Save image to tar
docker save ghcr.io/tokendancelab/agenthub-hub:$(git rev-parse --short HEAD) \
  | gzip > /tmp/agenthub-hub-image.tar.gz

# Transfer to hk2
scp /tmp/agenthub-hub-image.tar.gz hk2:/tmp/

# Load image on hk2
ssh hk2 "docker load < /tmp/agenthub-hub-image.tar.gz && rm /tmp/agenthub-hub-image.tar.gz"
```

### Step 2: Configure Environment

```bash
# SSH into hk2
ssh hk2

# Navigate to deploy directory
cd /opt/agenthub-hub/hub-server/deployments/hk2/

# First time: copy template and edit
cp .env.hk2.example .env.hk2
vim .env.hk2

# Or: pull secrets from local secure store
# scp C:\Users\Ding\.config\server-secrets\agenthub\.env.hk2 hk2:/opt/agenthub-hub/hub-server/deployments/hk2/
```

### Step 3: Deploy

```bash
# On hk2, in the deploy directory
cd /opt/agenthub-hub/hub-server/deployments/hk2/

# Set the image tag
export AGENTHUB_HUB_IMAGE=ghcr.io/tokendancelab/agenthub-hub:<commit-sha>

# Run deploy
bash deploy-hk2.sh deploy
```

Or use the remote deploy shortcut from your dev machine:

```bash
# From dev machine
bash hub-server/deployments/hk2/deploy-hk2.sh remote-deploy /tmp/agenthub-hub-image.tar.gz
```

### Step 4: Verify Deployment

```bash
# Container health
ssh hk2 "docker ps --format '{{.Names}} {{.Status}}' | grep agenthub"

# Hub health endpoint (localhost)
ssh hk2 "curl -fsS http://127.0.0.1:8090/health"

# Public health (through nginx + TLS)
curl -fsS https://hub.vectorcontrol.tech/health

# Full stack verification
ssh hk2 "cd /opt/agenthub-hub/hub-server/deployments/hk2 && bash deploy-hk2.sh status"
```

### Step 5: Post-Deploy Verification (Mandatory)

Per server AGENTS.md rules, verify all four layers:

1. **Container layer**: `docker ps` confirms agenthub-hub, agenthub-postgres, agenthub-redis running
2. **Application layer**: `curl http://127.0.0.1:8090/health` returns 200 + version
3. **Security layer**: Split-brain guard timer active, heartbeat <2min
4. **DR layer**: Komari `state=NORMAL`, `primary_host=hk2`

```bash
# Quick all-in-one check
ssh hk2 "docker ps --format '{{.Names}} {{.Status}}' | grep agenthub && curl -fsS http://127.0.0.1:8090/health"
ssh hk1 "curl -s http://127.0.0.1:25774/api/orchestrator/status"
```

## Environment Variable Checklist

### Required (must be set before deploy)

| Variable | Description |
|----------|-------------|
| `AGENTHUB_DB_PASSWORD` | PostgreSQL password (generate: `openssl rand -hex 16`) |
| `AGENTHUB_REDIS_PASSWORD` | Redis password (generate: `openssl rand -hex 16`) |
| `AGENTHUB_JWT_SECRET` | JWT signing key, min 32 chars (generate: `openssl rand -hex 32`) |
| `AGENTHUB_PPROF_PASS` | Admin endpoint password |
| `AGENTHUB_HUB_IMAGE` | Docker image tag to deploy |

### Optional (have defaults)

| Variable | Default | Notes |
|----------|---------|-------|
| `AGENTHUB_TOKENDANCE_ID_CLIENT_ID` | empty | Required for OIDC login |
| `AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET` | empty | Required for OIDC login |
| `AGENTHUB_S3_*` | empty | Enable S3 uploads when ready |
| `AGENTHUB_SERVER_LOG_LEVEL` | `info` | Set to `debug` for troubleshooting |
| `AGENTHUB_CORS_ORIGINS` | `https://hub.vectorcontrol.tech` | |

## Rollback Procedure

### Automated Rollback (if backup exists)

```bash
ssh hk2
cd /opt/agenthub-hub/hub-server/deployments/hk2/
bash deploy-hk2.sh rollback
```

### Manual Rollback

```bash
# 1. Find the rollback image tag
ssh hk2 "docker images --format '{{.Repository}}:{{.Tag}}' | grep agenthub-hub:rollback"

# 2. Tag it as the deploy target
ssh hk2 "docker tag <rollback-image> ghcr.io/tokendancelab/agenthub-hub:rollback"

# 3. Deploy the rollback image
ssh hk2 "cd /opt/agenthub-hub/hub-server/deployments/hk2/ && \
  AGENTHUB_HUB_IMAGE=ghcr.io/tokendancelab/agenthub-hub:rollback bash deploy-hk2.sh deploy"

# 4. Restore database if needed
ssh hk2 "ls /opt/agenthub-backups/agenthub-db-*.dump"
ssh hk2 "docker exec -i agenthub-postgres pg_restore -U agenthub -d agenthub --clean --if-exists < /opt/agenthub-backups/agenthub-db-<timestamp>.dump"
```

## Database Backup and Restore

### Manual Backup

```bash
ssh hk2 "cd /opt/agenthub-hub/hub-server/deployments/hk2/ && bash deploy-hk2.sh backup"
```

### Scheduled Backup (cron)

```bash
# Add to crontab on hk2
0 2 * * * /opt/agenthub-hub/hub-server/scripts/backup-db.sh
```

### Restore from Backup

```bash
ssh hk2
docker exec -i agenthub-postgres pg_restore -U agenthub -d agenthub --clean --if-exists < /opt/agenthub-backups/agenthub-db-<timestamp>.dump
```

## nginx Configuration

The nginx config is located at:
- Template: `hub-server/deployments/hk2/nginx-hk2.conf`
- Live on hk2: `/etc/nginx/sites-available/agenthub-hk2.conf` (symlinked to `sites-enabled/`)

### Installing nginx Config

```bash
# 1. Take snapshot (MANDATORY per server rules)
ssh hk2 "sudo /usr/local/bin/nginx-snapshot"

# 2. Copy config
scp hub-server/deployments/hk2/nginx-hk2.conf hk2:/tmp/agenthub-hk2.conf
ssh hk2 "sudo cp /tmp/agenthub-hk2.conf /etc/nginx/sites-available/agenthub-hk2.conf"

# 3. Enable
ssh hk2 "sudo ln -sf /etc/nginx/sites-available/agenthub-hk2.conf /etc/nginx/sites-enabled/"

# 4. Test and reload
ssh hk2 "sudo nginx -t && sudo systemctl reload nginx"
```

### SSL Certificate

The `api.vectorcontrol.tech` Let's Encrypt certificate (HTTP-01) covers `hub.vectorcontrol.tech` as it is included in the cert's SAN list. Verify with:

```bash
ssh hk2 "sudo certbot certificates"
```

If `hub.vectorcontrol.tech` is not covered, expand the cert:

```bash
ssh hk2 "sudo certbot --expand -d api.vectorcontrol.tech -d hub.vectorcontrol.tech"
```

## Troubleshooting

### Hub Server Not Starting

```bash
# Check container logs
ssh hk2 "docker logs agenthub-hub --tail=50"

# Common causes:
# - DB/Redis not ready → check health of postgres/redis containers
# - Missing env vars → verify .env.hk2
# - Port conflict → ss -tlnp | grep 8090
```

### Health Check Failing

```bash
# Direct container health (bypass nginx)
ssh hk2 "curl -v http://127.0.0.1:8090/health"

# Check Docker health status
ssh hk2 "docker inspect agenthub-hub --format='{{.State.Health.Status}}'"

# Check all AgentHub containers
ssh hk2 "docker ps --format '{{.Names}} {{.Status}}' | grep agenthub"
```

### WebSocket Issues

```bash
# Verify nginx WebSocket upgrade headers
curl -v -H "Upgrade: websocket" -H "Connection: Upgrade" \
  https://hub.vectorcontrol.tech/client/ws

# Check nginx error log
ssh hk2 "sudo tail -20 /var/log/nginx/agenthub-error.log"
```

### OAuth / OIDC Issues

```bash
# Check oauth2-proxy is running
ssh hk2 "curl -sf http://127.0.0.1:4181/ping"

# Check TokenDance ID connectivity
ssh hk2 "curl -sf https://id.vectorcontrol.tech/.well-known/openid-configuration"
```

### Disk Space Alert

```bash
# Check disk usage
ssh hk2 "df -h /"

# If >= 80%, DO NOT deploy. Clean up first:
# - Remove old rollback images (keep latest 2)
# - Trim Docker logs
# - Check WAL archive: /opt/vectorcontrol-hk2-stack/data/wal-archive/
```

### Container Resource Issues

```bash
# Check container resource usage
ssh hk2 "docker stats --no-stream agenthub-hub agenthub-postgres agenthub-redis"

# Expected ranges:
# hub-server:   ~8MiB RAM / 256MiB limit
# postgres:     ~22MiB RAM / 512MiB limit
# redis:        ~5MiB RAM / 384MiB limit
```

## File Locations

| File | Path |
|------|------|
| Deploy directory | `/opt/agenthub-hub/hub-server/deployments/hk2/` |
| Compose file | `deployments/hk2/docker-compose.hk2.yml` |
| Environment | `deployments/hk2/.env.hk2` |
| Deploy script | `deployments/hk2/deploy-hk2.sh` |
| nginx config | `/etc/nginx/sites-available/agenthub-hk2.conf` |
| Static homepage | `/opt/vectorcontrol-hk2-stack/agenthub-home/out/` |
| Backups | `/opt/agenthub-backups/` |
| Logs (Docker) | `docker logs agenthub-hub` |
| Logs (nginx) | `/var/log/nginx/agenthub-{access,error}.log` |

## Related Documents

- Server STATE: `C:\Users\Ding\server\STATE.md`
- AgentHub STATE: `C:\Users\Ding\server\projects\agenthub\STATE.md`
- Server AGENTS: `C:\Users\Ding\server\AGENTS.md`
- Hub Server README: `hub-server/deployments/README.md`
- Hub Server API docs: `hub-server/README.md`
