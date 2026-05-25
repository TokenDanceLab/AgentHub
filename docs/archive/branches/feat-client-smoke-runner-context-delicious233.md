# feat/client-smoke-runner-context-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 补强本地客户端 smoke，让默认自启动 Edge 时接入 Runner mock binary，并通过 WebSocket 验证当前 run 的 stdout 上下文。

## 写入范围

- `scripts/client-smoke.ps1`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/archive/branches/feat-client-smoke-runner-context-delicious233.md`

## 已完成

- [x] 自启动 Edge 时使用 `--runner-command <RunnerBinary> --runner-arg --mock`，避免只验证 Edge 内置 mock。
- [x] `-SkipBuild` 自启动路径检查 Edge / Runner 临时二进制是否存在，并给出明确错误。
- [x] WebSocket 验证改为读取 replay / 后续事件，匹配当前 `runId` 的 stdout `run.output.batch`。
- [x] 验证 stdout 中包含 `run=<runId>`、`project=proj_local`、`thread=thread_local`。
- [x] `-ReuseExistingEdge` 保留当前 run 的 WebSocket 事件验证，并跳过 Runner 上下文强断言。
- [x] Runner 独立检查改为显式捕获 stdout / stderr / exit code，避免 stderr 日志被 PowerShell 误判为失败。

## 下一步

- [ ] 后续接真实 Runner adapter 时，把 smoke 中的 mock runner 配置扩展为可选 profile，而不是只支持 mock binary。

## 验收

- [x] `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/client-smoke.ps1`
- [x] `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/client-smoke.ps1 -SkipBuild`
- [x] 手动启动 Edge 后运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/client-smoke.ps1 -SkipBuild -ReuseExistingEdge`
- [x] `git diff --check`
- [x] `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"`
- [x] `cd edge-server; go test -count=1 ./...`
- [x] `cd runner; go test -count=1 ./...`
