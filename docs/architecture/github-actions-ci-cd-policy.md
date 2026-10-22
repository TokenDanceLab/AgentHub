# GitHub Actions CI/CD policy

最后更新：2026-10-22

本文档定义 AgentHub 的 GitHub-hosted runner 测试链路与触发边界；具体 job、版本和脚本以 `.github/workflows/checks.yml`、`release-readiness.yml`、`release.yml` 及仓库内 verifier 为准。

## 目标

- Ubuntu 是主验证平台：Linux Go race/shard、集成服务、前端 unit/type/build、架构门禁和 Visual QA。
- Windows 是兼容性平台：原生 Go 单元测试，以及 Desktop 的 typecheck、unit test、production build。Web 由 Linux 验证。
- Tauri installer、NSIS、portable package 和 sidecar 组合只在 release-readiness 或 release 的明确 job 中运行，普通 PR 不编译完整安装包。
- 真实 OIDC、真实模型、生产部署、签名和 notarization 不属于普通 CI；必须走显式证据或审批链路。

## 流水线分层

| 层 | 触发 | 平台 | 内容 |
|---|---|---|---|
| Fast PR | `pull_request` / `push` 到 `master`，按路径过滤 | Ubuntu + Windows | Go unit/race shards、Hub/Edge fixture、前端 unit/type/build、Windows 原生合同、Visual QA shell、Web stubbed-hub Playwright、架构和安全 verifier |
| Extended manual | `workflow_dispatch` | Ubuntu | Mobile full、`e2e-smoke`、`real-e2e-stack` L3、backend perf/leak、Linux Tauri no-bundle |
| Release readiness | 发布/桌面文件变更或手动 | Ubuntu + Windows（macOS 仅显式手动） | `readiness-policy`、`windows-installer-smoke-preflight`；package dry 仅显式 opt-in |
| Release | semver tag | Ubuntu + Windows | release gate、跨平台 Go artifacts、Tauri 发布产物 |
| Release image | semver tag 或手动指定 ref | Ubuntu + native arm64 runner | 多架构 Hub Server 镜像、semver/latest tag 与 digest |

`cd-web.yml` 按 `app/Dockerfile` 的实际输入筛选 master push：Web/Shared/Workbench 源码、workspace manifest、lockfile、根 package manifest 和构建工作流。Workbench-only 改动同样产出新 Web 镜像；无关变更不触发。`cd-web.yml` / `cd-hub-server.yml` 构建并推送多架构 GHCR 镜像，不部署运行环境；构建成功只证明镜像产出。两者只保留各自的路径过滤与镜像参数，构建/合并流水线在 `cd-image.yml`（可复用 workflow）里只有一份。

`cd-production.yml` 直接监听 semver tag，避免 `workflow_run.head_branch` 在 tag 发布后回落为默认分支并把发布镜像误标成 `master`/`latest`；历史 tag 或明确 ref 只能通过 `workflow_dispatch` 输入重建。

## 分支保护与 required checks

`master` 使用 `strict=true`，PR 必须先与目标分支保持 up-to-date。稳定 required checks：`validate`、`go-hub`、`go-edge`、`windows-go`、`windows-frontend`、`backend-required`、`frontend-required`。

- `go-edge` / `go-hub` 在无 Go 变更时用受控 no-op 恒报；真实单元执行在 `go-edge-test` / `go-hub-test` 的两分片矩阵。lint、gosec、vet、staticcheck 在并行的 `go-*-static`；`go-*` 只做覆盖率合并与 fail-closed 结果断言。
- `go-*-static` 不是 required check：路径过滤跳过时恒报 job 按既有语义报绿 no-op，失败时经恒报 job 染红。
- `windows-go` / `windows-frontend` 只聚合执行矩阵结果，不自己跑测试。
- `backend-required` 聚合后端 L0/L1/L2；`frontend-required` 聚合前端 L0；`real-e2e-stack` 是 dispatch-only L3，不属于 required checks。

## 并行与成本策略

1. `concurrency.cancel-in-progress` 取消同一 PR 的旧运行。
2. `changes` 是统一路径过滤器；Go、前端、移动端、设计 CSS 和视觉 shell 只在相关变更时启动，手动 dispatch 默认运行完整选择面。`tests/fixtures/dispatch/**` 同时触发 Go、Desktop 与前端聚合。
3. Ubuntu Go unit 使用两个不重叠 package shard；shard 测试与静态门禁同时起跑，关键路径 = max(最慢 shard, 静态 job) + 覆盖率合并。
4. 前端 test 按 package matrix 并行；Windows 只跑 Desktop 原生合同；矩阵 `fail-fast: false` 保留所有失败根因。
5. `setup-go`/`setup-node` 依赖缓存、pnpm store、Rust cache 和 Docker Buildx GHA cache 复用稳定输入。
6. 安装器、Expo export、Rust/Tauri 打包不塞入 Fast PR；Playwright 与 Docker 服务只在路径相关的 PR lane 启动。

## 原生平台合同

### Ubuntu

- Go：`go-edge-test` / `go-hub-test` 的 race/shard 是主单元门禁；`go-*-static` 负责 lint、gosec、vet、staticcheck；`go-*` 是稳定 required check，负责覆盖率合并并 fail-closed 聚合。
- 服务行为：fixture E2E、Edge→Hub callback、PostgreSQL + Redis integration。
- `backend-required` 聚合 `go-edge`/`go-hub`/`backend-integration`/`backend-edge-e2e`/`backend-e2e-fixture`，`if: always()`；Go 无变化时退出 success 作为有意 no-op，`changes` 失败时 fail-closed，任一 lane 非 success 即失败。
- `frontend-required` 聚合 `frontend-desktop`/`frontend-web`/`frontend-mobile-light`，语义同上。
- Visual QA shell、stubbed-hub Playwright、CSS lint/syntax、vulnerability gate 按路径执行：job 自身 fail-closed（出错即失败，非 `continue-on-error`），但都不是 required check，不单独阻塞合并。

### Windows

- `windows-go-test` 在 `windows-latest` 对 `edge-server` 和 `hub-server` 运行 `go test ./... -short`，验证路径、进程、环境变量大小写和平台 API。
- `windows-frontend-test` 只对 `agenthub-desktop` 执行 typecheck、unit tests 和 production build；Web 的 typecheck、unit、build 由 Linux 执行一次。
- `windows-go` / `windows-frontend` 用稳定名聚合矩阵；路径过滤跳过时退出 success 作为有意 no-op，只代表“未触发”，不提供测试执行证据。
- Windows 原生合同不宣称 Tauri installer 可发布；installer 与 signing 仍由 release-readiness/release 的专门 job 负责。

### L3 真实 E2E

- L3 没有阻塞 PR 的 CI job；`checks.yml` 的 `real-e2e-stack`（dispatch-only）启动全栈并调用 `scripts/e2e/run-real-e2e-lane.sh`。
- L3 在独立全栈测试环境执行，入口 `scripts/dev/devserver.sh sync|start|stop|status|test|integration`；`test`/`integration` 不单独冒充真实 OIDC 浏览器证据。
- `scripts/e2e/wsl-full-stack-e2e.sh` 是 WSL 兼容入口，不是 required check。

## 开发者入口

```bash
make test
make fe-typecheck
make fe-test
python scripts/verify/verify-doc-ssot.py
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
git diff --check
git status --short --branch
```

Windows 原生合同：

```powershell
go test ./edge-server/... -short -count=1
go test ./hub-server/... -short -count=1
cd app
pnpm --filter agenthub-desktop typecheck
pnpm --filter agenthub-desktop test
pnpm --filter agenthub-desktop build
```

## Flake 策略

单元车道不重试（`retries=0`）。Playwright 车道只允许显式声明的有限重试：Web stubbed-hub lane 传 `--retries=1`；真实栈 lane 复用已启动的服务，以空 `CI` 运行，因此不重试（`retries=0`）；mobile-rn lane 在 `app/mobile-rn/playwright.config.ts` 声明 `retries: 1`；Visual QA 步骤最多执行两次（一次显式重试）。重试只用于吸收浏览器/网络抖动，不用于掩盖产品缺陷；retry 后才通过的用例仍需在报告中可见。

## 证据边界

- 执行型 job 的 success 表示步骤实际通过；受控 no-op success 只表示路径未触发。
- fixture、mock、stubbed Hub、observed local、approved real 和 packaged release 按 `scripts/verify/verify-real-e2e-contract.py` 的等级记录。
- screenshot 和构建产物上传 artifact，不提交仓库；临时输出、coverage、Playwright report 和 package dry artifacts 保持 gitignored。
- CI 失败先修脚本或代码；不得用 `continue-on-error`、`|| true`、空测试或降低 baseline 制造假绿。Advisory gate 必须有 owner、原因和收紧条件。
