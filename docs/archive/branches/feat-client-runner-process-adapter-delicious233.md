# feat/client-runner-process-adapter-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 为 Edge Run lifecycle 增加可测试的本地进程 executor。
- [x] 保持未配置 runner 命令时仍使用 MockExecutor。
- [x] 记录这是本地进程 executor 边界，不是完整真实 CLI adapter。

## 写入范围

- `edge-server/internal/lifecycle/`
- `edge-server/cmd/agenthub-edge/`
- `edge-server/internal/httpserver/`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/roadmaps/branches/feat-client-runner-process-adapter-delicious233.md`

## 已完成

- 新增 `ProcessExecutor`，通过 `exec.CommandContext` 启动可配置命令。
- 将 stdout / stderr 转为 `run.output.batch` 事件。
- 正常退出发布 `run.finished`，非零退出发布 `run.failed`，取消发布 `run.cancelled`。
- 增加并发 run map，重复启动返回 `ErrRunAlreadyStarted`，`Cancel(runID)` 可取消运行中的进程。
- `agenthub-edge` 增加 `--runner-command` 和可重复 `--runner-arg`，未配置时仍走 MockExecutor。
- 子进程会收到 `AGENTHUB_RUN_ID` / `AGENTHUB_PROJECT_ID` / `AGENTHUB_THREAD_ID`，用于后续真实 adapter 读取执行上下文。
- 修复交叉 review 发现的边界：缺失 run 不会启动外部进程，nil bus/store 会在构造期返回错误。
- 测试使用 Go test 自进程 helper，不依赖 shell、PowerShell、Claude Code、Codex 或 OpenCode。

## 验收

- [x] `cd edge-server; go test -count=1 ./internal/lifecycle ./cmd/agenthub-edge ./internal/httpserver`
- [x] 交叉 review 发现 1 个 High、1 个 Medium，均已修复。
- [x] `git diff --check`
- [x] `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"`
- [x] `cd edge-server; go test -count=1 ./...`
- [x] `cd runner; go test -count=1 ./...`

## 下一步

- [ ] 在真实 Runner adapter 任务中定义 CLI 入参、工作目录、环境变量、路径保护和错误映射。
