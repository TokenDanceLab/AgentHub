# GitHub Actions CI/CD policy

最后更新：2026-09-03

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
| Fast PR | `pull_request` / `push` 到 `master`，按路径过滤 | Ubuntu + Windows | Go unit/race shards、Hub/Edge fixture、前端 unit/type/build、Windows 原生合同、Web/Desktop Visual QA shell、Web stubbed-hub Playwright、架构和安全 verifier | 在免费额度内提供持续反馈 |
| Extended manual | `workflow_dispatch` | Ubuntu | Mobile full、`e2e-smoke`、`real-e2e-stack` L3、backend perf/leak、benchmark、Linux Tauri no-bundle；路径型 Visual QA/stubbed-hub 也可手动重跑 | 按需获取高成本或真实栈证据，不进入 PR 阻塞门禁 |
| Release readiness | 相关发布/桌面文件变更或手动触发 | Ubuntu + Windows（macOS 仅显式手动） | `readiness-policy`、`windows-installer-smoke-preflight`；`windows-package-dry`、`macos-unsigned-dry-policy`、`macos-package-dry` 仅显式 opt-in | 发布前验证，不替代 PR 快速门禁；不存在名为 `release-readiness` 的 job |
| Release | semver tag | Ubuntu + Windows | release gate、跨平台 Go artifacts、Tauri 发布产物 | 只从 tag 进入发布 |

## 分支保护与稳定 required checks

`master` 分支保护使用 `strict=true`，PR 必须先与目标分支保持 up-to-date。仓库要求的稳定 required-check 契约是 `validate`、`go-hub`、`go-edge`、`windows-go`、`windows-frontend`、`backend-required`、`frontend-required`。

- `go-edge` / `go-hub` 在无 Go 变更时用受控 no-op 恒报，真实单元执行在 `go-edge-test` / `go-hub-test` 的两分片矩阵；lint、lint fingerprint ratchet、gosec、vet、staticcheck（edge 另含 orchestrator 依赖方向门）在与分片并行的 `go-edge-static` / `go-hub-static`（#2251：这些门禁不消费覆盖率产物，不再串行排在测试之后）。两个恒报 job 只保留覆盖率合并与门禁，并对两条上游 lane 做 fail-closed 结果断言。`go-*-static` 本身不是 required check：它被路径过滤跳过时恒报 job 仍按既有语义报绿 no-op，它失败时经恒报 job 染红。
- `windows-go` / `windows-frontend` 只聚合执行矩阵结果，不自己跑测试。
- `backend-required` 聚合后端 L0/L1/L2；`frontend-required` 聚合前端 L0；`real-e2e-stack` 是 dispatch-only L3，不属于 required checks。

## 并行与成本策略

1. `concurrency.cancel-in-progress` 取消同一 PR 的旧运行，连续 push 不排队浪费分钟。
2. `changes` 是统一路径过滤器。Go、前端、移动端、设计 CSS 和视觉 shell 只在相关变更时启动；手动 dispatch 默认运行完整选择面。
3. Ubuntu Go unit 使用两个不重叠 package shard；Hub 和 Edge 各自的 shard 测试与静态门禁 job 同时起跑，恒报 job 在两者结束后才合并覆盖率证据并断言 lane 结果（关键路径 = max(最慢 shard, 静态 job) + 覆盖率合并，而非两段相加）。
4. 前端 coverage 按 package matrix 并行；Windows 前端按 Desktop/Web matrix 并行。矩阵 `fail-fast: false` 保留所有失败根因，避免一个平台取消另一个平台的诊断。
5. `actions/setup-go`、`actions/setup-node` 的依赖缓存、pnpm store、Rust cache 和 Docker Buildx GHA cache 复用稳定输入；lockfile 或版本变化自然生成新缓存键。
6. 浏览器安装、Expo export、Playwright、Docker 服务、Rust/Tauri 和 benchmark 是慢路径，不偷偷塞入 Fast PR。

## 原生平台合同

### Ubuntu

- Go：`go-edge-test`、`go-hub-test` 的 race/shard 是主单元门禁；`go-edge-static`、`go-hub-static` 负责 lint、lint fingerprint ratchet、gosec、vet、staticcheck（edge 另含 orchestrator 依赖方向门）；`go-edge`、`go-hub` 是稳定 required check，负责 coverage 合并与门禁并 fail-closed 聚合上述两条 lane。
- 服务行为：fixture E2E、Edge->Hub callback、PostgreSQL + Redis integration。
- `backend-required` 是后端 L0/L1/L2 的稳定 required-check 聚合：`needs` 聚合 `go-edge`/`go-hub`/`backend-integration`/`backend-edge-e2e`/`backend-e2e-fixture`，`if: always()` 恒报；Go 无变化时退出 `success` 作为有意 no-op，`changes` 失败时 fail-closed，Go 变化时任一 lane 非 `success` 即失败。`needs` 不含 `go-*-static`：静态 lane 的失败已由 `go-edge`/`go-hub` 传导，避免聚合图重复。
- `frontend-required` 是前端 L0 的稳定 required-check 聚合：`needs` 聚合 `frontend-desktop`/`frontend-web`/`frontend-mobile-light`/`frontend-coverage`，`if: always()` 恒报；路径未选中时退出 `success` 作为有意 no-op，`changes` 失败时 fail-closed，任一选中 lane 非 `success` 即失败（AGENTS「测试分层」L0 是 PR merge 门禁）。
- 前端其余面：Visual QA shell、stubbed-hub Playwright、CSS syntax、vulnerability gate 按路径执行，当前仍是 advisory（非 required check）。

### Windows

- `windows-go-test` 是执行矩阵：在 `windows-latest` 上对 `edge-server` 和 `hub-server` 运行 `go test ./... -short`，验证 Windows 路径、进程、环境变量大小写和平台 API 行为。
- `windows-frontend-test` 是执行矩阵：在 `windows-latest` 上对 `agenthub-desktop` 和 `agenthub-web` 并行执行 typecheck、unit tests 和 production build。
- `windows-go` 和 `windows-frontend` 是稳定 required-check 聚合 job：它们 `if: always()` 报告矩阵结果，分支保护只认这两个稳定名，不随矩阵基数变化。当路径过滤跳过执行矩阵时，聚合 job 退出 `success` 作为有意 no-op；该 success 只代表“未触发”，不提供测试执行证据。
- Windows 原生合同不宣称 Tauri installer 可发布；installer 与 signing 仍由 release-readiness/release 的专门 job 负责。

### L3 真实 E2E

- L3 没有阻塞 PR 的 CI job；`checks.yml` 提供 `real-e2e-stack`（显示名 `Real E2E stack (L3 lane, dispatch-only)`），仅在 `workflow_dispatch` 时启动全栈并调用 `scripts/e2e/run-real-e2e-lane.sh`。
- 日常 L3 执行面是远程 dev 服务器，统一控制入口为 `scripts/dev/devserver.sh sync|start|stop|status|test|integration`（#1681）。其中 `test` 与 `integration` 分别回传服务器侧短测试和集成测试报告，不应单独冒充真实 OIDC 浏览器证据。
- `scripts/e2e/wsl-full-stack-e2e.sh` 是 WSL 专属兼容入口，不是唯一 L3 入口，也不是 required check。

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

- 执行型 job 的 `success` 表示对应步骤实际通过；`go-edge`/`go-hub`/`windows-go`/`windows-frontend`/`backend-required`/`frontend-required` 的受控 no-op `success` 只表示路径未触发，不提供测试执行证据。
- fixture、mock、stubbed Hub、observed local、approved real 和 packaged release 证据必须按 `scripts/verify/verify-real-e2e-contract.py` 的等级记录。
- screenshot 和构建产物上传到 workflow artifact，不提交仓库；临时输出、coverage、Playwright report 和 package dry artifacts 必须保持 gitignored。
- CI 失败首先修复脚本或代码；不得用 `continue-on-error`、`|| true`、空测试保护或降低 baseline 制造假绿。现有 advisory gate 必须有 owner、原因和收紧条件。
