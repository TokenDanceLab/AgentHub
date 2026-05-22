# 分支路线图：feat/frontend-webui

最后更新：2026-05-23

## 分支目标

在 `feat/frontend-webui` 上搭建可维护的 Web 工作台架构，并保持它跟客户端本地链路的最新基线一致。

## 写入范围

- `app/web/`
- `docs/client-handoff.md`
- `docs/roadmaps/frontend.md`
- `docs/roadmaps/branches/feat-frontend-webui.md`
- `README.md`

## 已完成

- [x] 基于 `origin/feat/client-dev` 建立 `app/web` React + TypeScript 架构切片。
- [x] 复用 Local Edge 的 health、runners、runs 和 WebSocket events 契约。
- [x] 增加 Web API client、event client、工作台状态 reducer、hooks 和三栏 shell。
- [x] 增加 Web 单元测试，覆盖 API 错误、事件折叠和 shell 语义。
- [x] 将 `origin/master` 的客户端 M1 最新基线单向合入前端分支，未写入主线。
- [x] 将旧根 `ROADMAP.md` 的前端分支信息迁入 `docs/roadmaps/branches/feat-frontend-webui.md`。

## 下一步

- [ ] 等 UI 设计稿稳定后接入 `app/web/src/components/` 和 `app/web/src/styles/`。
- [ ] 客户端 M2 Project / Thread / Run / Item 接口落地后，把占位面板改成真实数据驱动。
- [ ] 评估 `app/desktop` 与 `app/web` 的 hooks/API client 是否应继续下沉到 `app/shared`。
- [ ] Web 稳定屏幕后补 Playwright 视觉和关键流程覆盖。

## 验收记录

- 2026-05-23：`cd app/web; pnpm test` 通过，3 files / 5 tests。
- 2026-05-23：`cd app/web; pnpm build` 通过。
- 2026-05-23：`git diff --check` 通过。
- 2026-05-23：`api/openapi.yaml` YAML 解析通过。
