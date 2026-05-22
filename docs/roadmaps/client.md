# 客户端路线图

最后更新：2026-05-23

## 负责范围

- Desktop
- Runner
- Edge 本地调度
- Agent CLI 进程
- workspace / worktree / diff / preview / approval

## 当前目标

推进 M2 Edge 本地数据层，把 M1 的内存事件流升级为 Project / Thread / Run / Item / Event 模型。当前 PR #30 已完成内存态最小模型，`feat/client-thread-messages-delicious233` 已补 message/item 写入链路，`feat/client-run-lifecycle-delicious233` 已抽出 Edge Run lifecycle executor 边界，`feat/client-store-boundary-delicious233` 已抽象可替换 store 接口，`feat/client-store-persistence-delicious233` 已提供轻量 JSON 文件持久化实现，`feat/client-edge-store-file-flag-delicious233` 已将文件 store 接入 Edge 启动参数，`feat/client-runner-process-adapter-delicious233` 已补本地进程 executor 边界，`feat/client-runner-workdir-delicious233` 已补本地进程工作目录配置边界，`feat/client-runner-adapter-profile-delicious233` 已补 generic adapter profile / 命令模板最小层，`feat/client-runner-profile-preset-delicious233` 已补仓库自带 mock Runner preset 入口，`feat/client-runner-context-delicious233` 已补 Runner mock 读取 Edge 注入上下文的最小契约，后续继续补真实 Runner adapter。

## 近期任务

- [x] 设计 Edge 本地 store 的最小边界。
- [x] 实现 Project / Thread / Run / Item 基础模型。
- [x] 让 EventStore 负责分配 `seq` 并支持按 cursor 重放。
- [x] 将 `POST /v1/runs` 绑定到 `projectId` / `threadId`，并保留 M1 空 body 兼容路径。
- [x] 补齐 Project / Thread / Item 查询接口。
- [x] 同步 `api/openapi.yaml`。
- [x] 抽象可替换 store 接口。
- [x] 实现轻量 JSON 文件持久化 store，验证 Edge 重启后 Project / Thread / Run / Item 可恢复。
- [x] 接入 Edge 启动参数 `--store-file <path>`，未传参数时仍使用内存 store。
- [ ] 后续按需要评估 SQLite 持久化方案。
- [x] 补齐 `POST /v1/threads/{threadId}/messages` 到 Item / event 的写入链路。
- [x] 抽出 Edge Run lifecycle executor 边界，替换 handler 内置 mock flow。
- [x] 增加可测试的本地进程 executor，覆盖 stdout/stderr 输出、正常退出、非零退出、取消和重复启动。
- [x] 增加本地进程工作目录配置，覆盖构造期目录验证和子进程实际运行目录；这不是完整 Claude Code / Codex / OpenCode adapter。
- [x] 增加 generic adapter profile / 命令模板最小层，覆盖 args/env 的 Run 占位符展开、未知占位符错误、固定 args 兼容和 workdir 不回退。
- [x] 增加 `--runner-profile agenthub-runner-mock`，覆盖默认 command、command override、用户 args/env 追加和未知 profile 错误。
- [x] 增加 Runner mock 上下文读取边界，覆盖 `AGENTHUB_RUN_ID` 默认值、env 注入 run ID 和 stdout 上下文输出。
- [ ] 将真实 Runner adapter 接入 Edge Run lifecycle。
- [ ] 细化 Project / Thread / Item 的 OpenAPI 响应 schema。

## 依赖

- `docs/client-handoff.md`
- `api/openapi.yaml`
- `api/events.md`
- `docs/system-architecture.md`
- `docs/implementation-guide.md`

## 验收

- [x] `cd edge-server; go test ./...`
- [x] `cd runner; go test ./...`
- [x] `cd app/desktop; pnpm test`
- [x] `cd app/desktop; pnpm build`
- [ ] `pnpm test:e2e`
- [ ] `.\scripts\client-smoke.ps1`
