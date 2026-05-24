# feat/client-thread-messages-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 实现 `POST /v1/threads/{threadId}/messages`，把用户消息写入 Edge store 的 Thread Item。
- [x] 同步 `message.created` 和 `item.created` typed events。
- [x] 同步 OpenAPI 和客户端路线图。

## 写入范围

- `edge-server/internal/api/`
- `edge-server/internal/store/`
- `api/openapi.yaml`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/roadmaps/branches/feat-client-thread-messages-delicious233.md`

## 已完成

- `POST /v1/threads/{threadId}/messages` 支持必填 `content` 和可选 `role`，省略 `role` 时默认 `user`。
- 成功请求创建 `Type=user_message`、`Status=created` 的 `store.Item`。
- 成功请求发布 `message.created` 和 `item.created`，scope 包含 `projectId`、`threadId`、`itemId`。
- 空 content 返回 400，未知 thread 返回 404，非法 JSON 返回 400。
- 补充 handler/store 测试覆盖成功、默认 role、指定 role、失败路径和事件发布。

## 验收

- [x] `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"`
- [x] `cd edge-server; go test ./...`
- [x] `git diff --check`
- [x] `git status --short --branch`

## 下一步

- [ ] 抽象可替换 store 接口并评估 SQLite / 文件持久化。
- [ ] 将 Runner 真正接入 Edge Run lifecycle，替换 handler 内置 mock flow。
