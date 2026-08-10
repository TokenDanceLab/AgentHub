# WSL 全栈 E2E（proposal-wsl-full-stack-e2e）

> SPEC completed — pending external archive

- 状态：**SPEC（2026-08-06 实现并首次跑通）**
- Owner：AgentHub / 部署与集成验证
- 关联：`docs/architecture/05-deployment.md`、`docs/governance/governance-execution.md`、TokenDanceID `scripts/verify-agenthub-e2e.ps1`

## 目标

在本地 WSL（Ubuntu-24.04）内以**容器形态**部署完整 AgentHub 栈并执行**真实 OIDC 登录**端到端断言，把"部署形态 == 生产形态"的验证沉淀为可重复命令，产出机器可读证据。不再依赖手工逐步启动与试错。

## 为什么需要（背景）

- 之前的登录/部署验证散落在手工命令与一次性脚本里，存在大量可复现性缺陷：
  - `/mnt/d`（drvfs 9p）与 WSL 之间 `cp -r` 源码复制会随机丢失文件（如 `go.mod`）、`rm -rf node_modules` 报 "Directory not empty"；
  - WSL docker daemon 配置了**死链镜像源**（`mirror.baidubce.com`）导致镜像拉取直接失败；
  - `docker.io` 直连超时，需要代理，但 daemon 未配置；
  - 手工 `go run` 链路与本机 Go 工具链、内存、残留进程耦合，状态不可靠；
  - 仓库根 `docker-compose.yml` 的 hub-server `build.context: ./hub-server` 与 Dockerfile 硬要求（`COPY go.work/pkg/edge-server`，context 必须为仓库根）矛盾，`docker compose up --build` 必然失败。
- 本设计将这些一次性问题全部固化为**自动检测与修复**，并把验证收敛为一条命令。

## 架构

```
verify-wsl-full-stack-e2e.py（Windows 编排，stdlib only）
  └─ 前置检查：wsl 可用、distro 探测（UTF-16 容错）、脚本存在
  └─ wsl -e bash scripts/e2e/wsl-full-stack-e2e.sh <Project> <Keep> <EvidenceDir>
        ├─ 阶段0 环境自检/修复（幂等）：
        │     · daemon.json 死链 registry-mirrors 自动移除并重启 daemon
        │     · docker.io 直连失败 → 检测 Clash 127.0.0.1:7897 → 配置 systemd docker 代理
        ├─ 阶段1 源码：git clone file://（committed HEAD，天然排除 node_modules/私钥）
        ├─ 阶段2 生成独立 compose（pg/redis/id/hub 容器，随机 JWT/账号/密钥，高位端口）
        ├─ 阶段3 docker compose build（串行控内存）+ up + 健康等待
        ├─ 阶段4 seed：register → login（cookie）→ 创建 OAuth client（API 全流程）
        ├─ 阶段5 真实 OIDC PKCE 登录流断言：
        │     1 hub authorize（S256 challenge）→ state/authorization_url
        │     2 未认证访问 → 302 /login
        │     3 登录 → td_session cookie
        │     4 consent 页（提取 authorization_request_id + csrf_token）→ confirm → code
        │     5 hub callback 交换 → Hub access/refresh token
        │     6 /client/auth/me 产品 API 认证
        │     7 WebSocket 升级（subprotocol 携带 Hub JWT）+ ping/pong
        │     8 负测试：伪造 code 必须被拒
        └─ 阶段6 证据 manifest JSON（integration 级）+ 默认清理（trap）
```

### 关键设计决策

| 决策 | 理由 |
|---|---|
| 全容器化（hub/id 走各自 Dockerfile build） | 与生产部署形态一致；消除本机 Go 工具链依赖与 drvfs 复制问题 |
| `git clone file://` 而非 `cp -r` | git 自动排除 gitignored 大目录与私钥；committed 状态可复现 |
| 每次运行生成随机 JWT secret / 测试账号 / OAuth client | 无固定 secret、无跨运行冲突、可重复 |
| `extra_hosts: id:host-gateway` + issuer 用服务名 | 容器内访问 TDID 走 compose DNS；脚本从宿主用 `127.0.0.1:13000` 访问同一服务 |
| 端口高位固定（id 13000 / hub 18080 / pg 15432 / redis 15437） | 避开本地开发端口，可预测 |
| seed 全走 API（register/login/clients） | 与真实用户路径一致（含 consent 页），无需 SQL 直插与 bcrypt 预生成 |
| trap cleanup + `-Keep` 保留模式 | 默认无残留；调试时可保留栈 |
| 环境修复幂等 | 重复运行不产生重复配置/重启 |
| 输出行契约 `E2E-PASS/FAIL/INFO/RESULT` | python 编排与 CI 可机器解析 |

## 用法

```bash
# Windows 侧（stdlib only，无第三方依赖）
python scripts/e2e/verify-wsl-full-stack-e2e.py                 # 跑完自动清理
python scripts/e2e/verify-wsl-full-stack-e2e.py -Keep           # 保留栈便于复查
python scripts/e2e/verify-wsl-full-stack-e2e.py -EvidenceDir .tmp/e2e-evidence
```

退出码：0 = 全部断言通过；1 = 任一失败。证据：`.tmp/e2e-evidence/evidence.json`（含 `real_tokendance_id_login: true`，`evidence_level: integration`）。

前置条件：本机有 WSL（默认发行版，含 docker + systemd + sudo 免密），`d:/Code/TokenDance` 下同时存在 `AgentHub` 与 `tokendance-id` 两个仓（用 `-SrcRoot` 可换）。

## 边界与诚实性

- **测试专用 seeded 身份**：`e2e-user@test.local` + 随机密码，运行期在临时 SQLite/容器内创建，不触碰任何生产账号、生产环境或真实密钥。
- **证据等级 = integration**：真实服务、真实 OIDC 协议流、真实登录（seeded 身份），但**不是** production approved-real 证据；发布级真实登录仍按 `verify-login-e2e-readiness.py` 的审批门禁执行。
- 构建与拉取耗时：首次全量 build（两个 Go 镜像）约 5-15 分钟（受网络/内存影响），后续受 docker build cache 加速。
- 内存：建议 WSL 可用内存 ≥ 2GB（本项目 4GB 可跑通，串行 build 控制峰值）。

## 验收

- [x] WSL 环境自检与死链镜像源/代理自动修复幂等生效
- [x] 容器形态四服务健康（id/hub/pg/redis）
- [x] 真实 OIDC Authorization Code + PKCE 登录流 8 项断言全过
- [x] 证据 manifest 落盘且 `real_tokendance_id_login=true`
- [x] 默认清理无残留（容器/网络/临时目录）
- [ ] CI 接线（workflow_dispatch 手动触发，待定——本地验证类命令不阻塞发布门禁）
