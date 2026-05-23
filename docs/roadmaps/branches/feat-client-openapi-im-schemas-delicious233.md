# feat/client-openapi-im-schemas-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 对齐当前 Edge Go 实现，细化 P0 Project / Thread / Item REST API 的 OpenAPI schema。

## 写入范围

- `api/openapi.yaml`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/roadmaps/branches/feat-client-openapi-im-schemas-delicious233.md`

## 已完成

- [x] 为 `/v1/projects` GET / POST 和 `/v1/projects/{projectId}` GET 接入 `Project`、`CreateProjectRequest`、`ProjectListResponse`。
- [x] 为 `/v1/threads` GET / POST、`/v1/threads/{threadId}` GET 和 `/v1/threads/{threadId}/items` GET 接入 `Thread`、`CreateThreadRequest`、`ThreadListResponse`、`ItemListResponse`。
- [x] 为 `/v1/items/{itemId}` GET 接入 `Item` schema 和 `404` 错误响应。
- [x] 保留现有 `/v1/threads/{threadId}/messages` 和 `Item` 结构，并按当前实现补充字段描述和稳定枚举。

## 下一步

- [ ] 后续如 Go 实现新增 P1/P2 IM 接口，再单独补对应 schema。

## 验收

- [x] `git diff --check` 通过。
- [x] `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"` 输出 `yaml ok`。
- [x] `cd edge-server; go test -count=1 ./...` 通过。
- [x] `cd runner; go test -count=1 ./...` 通过。
