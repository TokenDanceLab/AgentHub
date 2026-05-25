# feat/client-m2-edge-data-layer-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 推进 M2 Edge 本地数据层的 Project / Thread / Run / Item 最小可测试实现。
- [x] 保持 M1 health / runners / runs / events 和 Desktop Shell 验证入口可用。
- [x] 固化 EventStore `seq` / cursor replay 的裁剪窗口行为测试。
- [x] 让 `POST /v1/runs` 支持绑定 `projectId` / `threadId`，同时保留空 body 默认本地 project/thread 的兼容路径。

## 写入范围

- `edge-server/internal/store/`
- `edge-server/internal/api/`
- `edge-server/internal/events/`
- `api/openapi.yaml`
- `docs/roadmaps/branches/feat-client-m2-edge-data-layer-delicious233.md`

## 本轮完成

- 新增 Edge 内存 store，覆盖 Project / Thread / Run / Item 的创建、查询、列表过滤和 Run 状态更新时间戳。
- Edge HTTP handlers 接入本地 store，新增 Project / Thread / Item 基础路由，并让 Run 查询返回已记录的本地 Run。
- `POST /v1/runs` 新增可选 `projectId` / `threadId` request body；空 body 继续落到 `proj_local` / `thread_local`，避免破坏现有 Desktop mock run。
- Run mock flow 继续发布 `run.queued` / `run.started` / `run.output.batch` / `run.finished`，并在 store 中更新 Run 状态。
- Event bus 测试补充 history trim 后 cursor replay 的确定性用例，并把并发发布验证改为基于 history replay 的 seq 完整性检查。
- `api/openapi.yaml` 同步 `StartRunRequest` 和 `Run` schema。

## 验收记录

- [x] `git diff --check`
- [x] `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"`
- [x] `cd edge-server; go test ./...`
- [x] `cd runner; go test ./...`
- [x] `cd app/desktop; pnpm install`
- [x] `cd app/desktop; pnpm test`
- [x] `cd app/desktop; pnpm build`
- [x] 主控复验：PR #30 base=`master`、head=`feat/client-m2-edge-data-layer-delicious233`、mergeState=`CLEAN`、GitHub Actions `validate` 通过。
- [ ] 仓库根目录 `go test ./...`：当前根目录不是 Go module / workspace，命令返回 `pattern ./...: directory prefix . does not contain main module or its selected dependencies`；本轮用 `edge-server` 和 `runner` 两个 Go module 分别验收。

## 下一步

- [ ] 将 EventStore 从内存 history 抽象成可替换接口，为后续 SQLite / 文件持久化留入口。
- [ ] 补齐 `POST /v1/threads/{threadId}/messages` 到 Item / message event 的最小实现。
- [ ] 将 Runner 真正接入 Edge Run lifecycle，替换当前 handler 内置 mock flow。
- [ ] API schema 后续补齐 Project / Thread / Item 的具体响应 schema，减少 `Resource` 泛型响应。
