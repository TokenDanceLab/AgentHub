# GitHub Actions CI/CD policy

最后更新：2026-08-17

本文档定义 AgentHub 的免费 GitHub-hosted runner 测试链路。它描述职责和触发边界；具体 job、版本和脚本以 `.github/workflows/checks.yml`、`release-readiness.yml`、`release.yml` 及仓库内 verifier 为准。

## 目标

AgentHub 使用 Ubuntu 和 Windows 原生 runner 验证不同类别的问题：

- Ubuntu 是主验证平台，承载 Linux Go race/shard、集成服务、前端覆盖率、架构门禁和 Visual QA。
- Windows 是兼容性平台，承载原生 Go 单元测试以及 Desktop/Web 的 typecheck、unit test、production build。
- Tauri installer、NSIS、portable package 和 sidecar 组合只在 release-readiness 或 release 的明确 job 中运行，不让每个普通 PR 都编译完整安装包。
- 真实 OIDC、真实模型、生产部署、签名和 notarization 不属于普通 CI；它们必须走显式证据或审批链路。

## 流水线分层

| 层 | 触发 | 平台 | 内容 | 目的 |
|---|---|---|---|---|
| Fast PR | `pull_request` / `push` 到 `master`，按路径过滤 | Ubuntu + Windows | Go unit/race shards、Hub/Edge fixture、前端 unit/type/build、Windows 原生合同、架构和安全 verifier | 在免费额度内提供持续反馈 |
| Extended manual | `workflow_dispatch` | Ubuntu | Mobile full、Playwright smoke、Visual QA、backend perf/leak、benchmark、Linux Tauri no-bundle | 按需获取高成本证据 |
| Release readiness | 相关发布/桌面文件变更或手动触发 | Ubuntu + Windows（macOS 仅显式手动） | package policy、Windows installer preflight、可选 unsigned dry package | 发布前验证，不替代 PR 快速门禁 |
| Release | semver tag | Ubuntu + Windows | release gate、跨平台 Go artifacts、Tauri 发布产物 | 只从 tag 进入发布 |

## 并行与成本策略

1. `concurrency.cancel-in-progress` 取消同一 PR 的旧运行，连续 push 不排队浪费分钟。
2. `changes` 是统一路径过滤器。Go、前端、移动端、设计 CSS 和视觉 shell 只在相关变更时启动；手动 dispatch 默认运行完整选择面。
3. Ubuntu Go unit 使用两个不重叠 package shard；Hub 和 Edge 各自先并行执行 shard，再由 lint/coverage job 合并证据。
4. 前端 coverage 按 package matrix 并行；Windows 前端按 Desktop/Web matrix 并行。矩阵 `fail-fast: false` 保留所有失败根因，避免一个平台取消另一个平台的诊断。
5. `actions/setup-go`、`actions/setup-node` 的依赖缓存、pnpm store、Rust cache 和 Docker Buildx GHA cache 复用稳定输入；lockfile 或版本变化自然生成新缓存键。
6. 浏览器安装、Expo export、Playwright、Docker 服务、Rust/Tauri 和 benchmark 是慢路径，不偷偷塞入 Fast PR。

## 原生平台合同

### Ubuntu

- Go：`go-edge-test`、`go-hub-test` 的 race/shard 是主单元门禁；`go-edge`、`go-hub` 负责 lint、gosec、staticcheck 和 coverage。
- 服务行为：fixture E2E、Edge->Hub callback、PostgreSQL + Redis integration。
- `backend-required` 是后端 L0/L1/L2 的稳定 required-check 聚合：`needs` 聚合 `go-edge`/`go-hub`/`backend-integration`/`backend-edge-e2e`/`backend-e2e-fixture`，`if: always()` 恒报；Go 无变化时退出 `success` 作为有意 no-op，`changes` 失败时 fail-closed，Go 变化时任一 lane 非 `success` 即失败。
- 前端：Desktop/Web/mobile 按路径执行，coverage、CSS syntax、vulnerability gate 和 Visual QA 各自独立。

### Windows

- `windows-go-test` 是执行矩阵：在 `windows-latest` 上对 `edge-server` 和 `hub-server` 运行 `go test ./... -short`，验证 Windows 路径、进程、环境变量大小写和平台 API 行为。
- `windows-frontend-test` 是执行矩阵：在 `windows-latest` 上对 `agenthub-desktop` 和 `agenthub-web` 并行执行 typecheck、unit tests 和 production build。
- `windows-go` 和 `windows-frontend` 是稳定 required-check 聚合 job：它们 `if: always()` 报告矩阵结果，分支保护只认这两个稳定名，不随矩阵基数变化。当路径过滤跳过执行矩阵时，聚合 job 退出 `success` 作为有意 no-op；该 success 只代表“未触发”，不提供测试执行证据。
- Windows 原生合同不宣称 Tauri installer 可发布；installer 与 signing 仍由 release-readiness/release 的专门 job 负责。

## 开发者入口

本地应先跑与改动相同的最窄层，再在提交前跑完整本地 gate：

```bash
make test
make fe-typecheck
make fe-test
python scripts/verify/verify-ci-gates.py
python scripts/verify/verify-doc-ssot.py
python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"
git diff --check
git status --short --branch
```

Windows 原生合同可直接运行：

```powershell
go test ./edge-server/... -short -count=1
go test ./hub-server/... -short -count=1
cd app
pnpm --filter agenthub-desktop typecheck
pnpm --filter agenthub-desktop test
pnpm --filter agenthub-desktop build
pnpm --filter agenthub-web typecheck
pnpm --filter agenthub-web test
pnpm --filter agenthub-web build
```

PowerShell 命令中的 `go test ./edge-server/...` 仅适用于从仓库根运行的路径模式；进入模块目录后使用 `go test ./...` 与 CI 保持一致。

## 证据边界

- `success` 只表示对应 job 实际执行并通过；被路径过滤跳过的 job 不得被描述为已测试。
- fixture、mock、stubbed Hub、observed local、approved real 和 packaged release 证据必须按 `scripts/verify/verify-real-e2e-contract.py` 的等级记录。
- screenshot 和构建产物上传到 workflow artifact，不提交仓库；临时输出、coverage、Playwright report 和 package dry artifacts 必须保持 gitignored。
- CI 失败首先修复脚本或代码；不得用 `continue-on-error`、`|| true`、空测试保护或降低 baseline 制造假绿。现有 advisory gate 必须有 owner、原因和收紧条件。
