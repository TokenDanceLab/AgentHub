---
title: ops-hk3
summary: 生产运维指针——AgentHub LIVE 在 hk3，所有运维权威事实见 server STATE.md，本页不复制 secrets/endpoint/token；记录 CI 叙事漂移与当前已知矛盾
tags: [ops, production, hk3, live, pointer, narrative-drift]
sources:
  - docs/architecture.md
  - docs/decisions.md
  - docs/governance/security-risk-register.md
  - server projects/agenthub/STATE.md（运维 SSOT，不在此仓库）
  - docs/analysis/_raw_lane_results.json
updated: 2026-07-16
---

# ops-hk3：生产运维指针

> 本页是 **指针**，不是运维事实的副本。运维 SSOT 在 `C:\Users\Ding\server\projects\agenthub\STATE.md`，本页只记录 AgentHub 仓库内需要对齐的事项。

## 生产形态

| 面 | 当前事实 |
|---|---|
| LIVE 主机 | **hk3**，部署路径 `/opt/agenthub` |
| Hub Server 容器 | `ghcr.io/tokendancelab/agenthub-hub-server:latest`（见 `deployments/production/docker-compose.yml`） |
| 数据库 | Azure PostgreSQL，角色 `agenthub` |
| 反向代理 | Nginx 在 **hk2**，proxy `/api` `/ws` 到 `127.0.0.1:8090`（Hub on hk3） |
| 运维 SSOT | `C:\Users\Ding\server\projects\agenthub\STATE.md`——本仓库不复制 |

关键理解：AgentHub 生产是多主机拓扑（hk2 nginx + hk3 Hub），不是单机 all-in-one。

## CI 叙事漂移（已知矛盾）

以下矛盾已在 [[cleanup-playbook]] 中登记修复计划，此处汇总供 ops 感知：

### 1. LIVE vs decommissioned 信号冲突

| 来源 | 声称 |
|---|---|
| `server STATE.md` | 当前角色：**LIVE hk3** |
| `.github/workflows/checks.yml` | 旧注释称 AgentHub **"decommissioned"** |

**影响**：CI/Agent 可能低估生产影响面，跳过 prod-impacting gate。checks.yml 注释必须更新为"LIVE hk3，CI 应跑全量 gate"。

### 2. 镜像名不一致

| 文件 | 镜像名 |
|---|---|
| `deployments/production/docker-compose.yml` | `ghcr.io/tokendancelab/agenthub-hub-server:latest` |
| `.github/workflows/cd-production.yml` | `IMAGE_NAME .../agenthub-hub` |
| `.github/workflows/cd-hub-server.yml` | `agenthub-hub-server` |

**影响**：部署/回滚命令可能拉错镜像，发布自动化不可信。必须统一到一个镜像名。

### 3. DB 拓扑模板残留

| 文件 | DB 配置 |
|---|---|
| `deployments/production/` | Azure PG |
| `hub-server/deployments/docker-compose.prod.yml` | 独立 local postgres |

**影响**：运维人员可能按旧模板重建已废弃的本地 PG 栈。旧 local postgres 模板应标记为 historical 或删除。

### 4. 验证命令引用旧主机

`STATE.md` 中 Verification Commands 仍引用 `ssh hk2/us1 /opt/tokendance compose agenthub`，但当前主机是 hk3 `/opt/agenthub`。健康检查和事故响应可能跑在历史拓扑上。

### 5. Multi-host 拓扑理解

由于 nginx 在 hk2、Hub 容器在 hk3，文档不得暗示单机 all-in-one。Edge routing 理解依赖此多主机现实。

## 安全风险——生产验证队列

以下 [[risks-open]] 项已有代码缓解，但**缺少生产部署/运行证据**，阻断公开发布：

| ID | 严重度 | 需要证据 |
|---|---|---|
| [[risks-open#AH-SR-028]] | Critical | 轮换所有部署实例 JWT secret |
| [[risks-open#AH-SR-035]] | High | staging/production OIDC browser login 闭环证据 |
| [[risks-open#AH-SR-036]] | High | Desktop 对 live Hub 完成 login/logout/reconnect 证据 |
| [[risks-open#AH-SR-048]] | High | 真实 adapter smoke 审查 runtime/debug 日志，确认不泄露 |
| [[risks-open#AH-SR-049]] | High | Edge outbox/journal + idempotent ack + replay 端到端合同 |

证据存放：私有运维文档，本仓库只写无密结论和指针。

## 运维红线（重申）

以下来自 [[overview]] 及 `AGENTS.md`：

1. **不提交 secrets**：`.env`、API key、token、生产 IP、DB 连接串一律不入仓
2. **运维事实不回灌**：server STATE.md 是运维 SSOT，不在此仓库复制
3. **发布门禁**：Critical/High 风险未 close 或 accepted 前，阻断公开发布
4. **Mock vs Production 区分**：`stub/fixture/readiness-only` 不得冒充真实登录、真实模型/API、packaged Desktop 或 release

## 验证入口（本地）

```powershell
# 文档/API 一致性
pwsh ./scripts/verify/verify-doc-ssot.ps1
pwsh ./scripts/verify/verify-live-chain-topology.ps1
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"

# Go 后端
cd hub-server; go test ./... -short -count=1
cd ../edge-server; go test ./... -short -count=1

# 前端
cd app/desktop; corepack pnpm test; corepack pnpm typecheck
cd ../web; corepack.cmd pnpm typecheck; corepack.cmd pnpm exec vite build
```

## 相关页面

- [[overview]]——AgentHub 架构入口
- [[cleanup-playbook]]——CI 叙事漂移修复计划
- [[risks-open]]——安全风险登记表与关闭条件
- [[architecture-seams]]——架构缝合线与 god-file 切分
- [[module-hub]]——Hub Server 模块
- [[module-edge]]——Edge Server 模块
