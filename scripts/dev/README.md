# scripts/dev — 开发与测试平台脚本

## devserver.sh（远程 dev 服务器测试平台，L3 真实测试面）

统一入口：`scripts/dev/devserver.sh <sync|start|stop|status|test|integration>`。

远程服务器承载 L3 真实测试（全栈：TokenDanceID + hub + edge + web vite），
本脚本从本地发起同步、启动、健康检查与测试报告回传。分层定义见
根 `AGENTS.md` §5.5；平台设计见 issue #1681。

### 前置配置（全部本机，仓库不存任何地址/凭据）

1. 在私有运维配置中准备 SSH 目标，并通过 `AGENTHUB_DEVSERVER_SSH` 传入。
   公开仓库不记录该目标的 alias、主机名、地址或登录用户。

2. 默认调用 PATH 中的 `ssh`。若运行环境需要受控 wrapper / 独立 ssh client，可把 `AGENTHUB_DEVSERVER_SSH_BIN` 设为一个 ssh-compatible 可执行文件路径；脚本不解析任意 shell 参数字符串。

3. 服务器仓库路径可通过 `AGENTHUB_DEVSERVER_ROOT` 私有覆盖；公开默认值仅为
   `/srv/agenthub/AgentHub`，不对应任何具体机器。

4. 服务器本地 `.env` 必须包含启动所需全部键（`AGENTHUB_DB_*`、
   `AGENTHUB_TOKENDANCE_ID_*`、`AGENTHUB_JWT_SECRET`）；缺键时 `start`
   会 fail-closed 并指出缺哪个键，值永不出服务器。

5. 若真实测试服务器出站受限，Go 依赖访问沿用该环境的服务器侧运维策略。
   `devserver.sh` 会兼容既有 `/etc/environment` / `DEVSERVER_GOPROXY` 配置；
   私有镜像地址、账号和凭据都不要写进仓库。

### 证据纪律

- `sync` 只在服务器工作树干净时允许快进；脏树先处理（避免证据跑在
  未知代码上）。
- `test` / `integration` 回传 JSON 报告到本地 `.tmp/devserver-reports/`
  （gitignored），报告只保留 commit/branch/arch/结果等可公开测试证据，
  **不写远端 hostname / 地址 / SSH alias**；筛选后才可附 PR/issue。

### integration 命令与测试库隔离

`integration` 对齐 CI `backend-integration` job（真实 PostgreSQL +
Redis）：每次运行前在服务器 PG 上 DROP+CREATE 独立测试库
`agenthub_test`，与 CI 的 ephemeral service 容器语义一致。共享 dev 库
会被重复运行的残留数据污染（用户/session/owner-scope 断言失败），
因此 lane 必须跑在全新数据库上；`integration` 把这条纪律固化在命令里，
凭据仍从服务器 `.env` 提取、不出仓库。

## 其他脚本

| 脚本 | 职责 |
|---|---|
| `dev-start.py` / `dev-start.sh` | 本地开发栈（edge+hub+desktop），Ctrl+C 前台模型 |
| `dev-up.sh` / `dev-down.sh` | 本地依赖容器（compose postgres/redis）启停 |
| `devserver.sh` | 远程 dev 服务器测试平台（本文件） |
