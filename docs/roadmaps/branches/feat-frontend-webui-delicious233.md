# 分支路线图：feat/frontend-webui-delicious233

最后更新：2026-05-23

## 分支目标

在 `feat/frontend-webui` 基线上补强 Web API client 和事件状态层，让前端后续接入 Project / Thread / Run / Item 时不直接依赖组件拼接 REST URL 或临时事件日志。

## 写入范围

- `app/web/`
- `docs/roadmaps/branches/feat-frontend-webui-delicious233.md`

## 已完成

- [x] 扩展 Web `edgeClient`，集中封装 Project / Thread / Thread Item / Item / Run 列表读取入口。
- [x] 扩展 `workbenchState` reducer，按事件维护 `projectsById`、`threadsById`、`itemsById` 和带 thread 归属的 `runsById`。
- [x] 为 API client 路径、REST 分页参数、事件 scope fallback、Project / Thread / Item / Run 状态折叠补充单元测试。
- [x] 保持 UI 壳不做视觉重构，仅补工程化和状态边界。

## 下一步

- [ ] 客户端 M2 返回具体 Project / Thread / Item payload 后，将 `app/web/src/api/edgeClient.ts` 的本地资源类型与真实字段对齐。
- [ ] 在不影响 UI 设计稿的前提下，把侧栏 Project / Thread 列表从 mock 展示改为读取 `edgeClient` snapshot。
- [ ] WebSocket 事件稳定后补 `eventClient` 重连和 cursor 行为测试。

## 验收记录

- 2026-05-23：`cd app/web; pnpm install` 完成，原因是本 worktree 缺少 `node_modules`，lockfile 未重新解析。
- 2026-05-23：`git diff --check` 通过。
- 2026-05-23：`cd app/web; pnpm test` 通过，3 files / 8 tests。
- 2026-05-23：`cd app/web; pnpm build` 通过。
