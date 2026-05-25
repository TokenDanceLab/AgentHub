# feat/client-store-persistence-delicious233 路线图

最后更新：2026-05-23

## 当前目标

- [x] 为 Edge 本地 store 增加首个轻量 JSON 文件持久化实现，用于验证 Edge 重启后 Project / Thread / Run / Item 可恢复。

## 写入范围

- `edge-server/internal/store/`
- `docs/roadmap.md`
- `docs/roadmaps/client.md`
- `docs/roadmaps/branches/feat-client-store-persistence-delicious233.md`

## 已完成

- [x] 新增 `store.NewFile(path string)`，从 JSON snapshot 恢复，不存在时使用空 store，坏 JSON 返回错误。
- [x] `FileStore` 复用内存 `Store` 行为，并在写入后用临时文件加 rename 保存 snapshot。
- [x] Snapshot 覆盖 projects、threads、runs、items 和对应 order 列表，保留 list 顺序。
- [x] 新增文件持久化测试，使用 `t.TempDir()`，不写本机固定路径。

## 验收

- [x] 基线 `cd edge-server; go test ./...` 通过。
- [x] 基线 `cd runner; go test ./...` 通过。
- [x] 局部 `cd edge-server; go test ./internal/store` 通过。
- [x] 收口 `git diff --check` 通过。
- [x] 收口 `python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"` 通过。
- [x] 收口 `cd edge-server; go test ./...` 通过。
- [x] 收口 `cd runner; go test ./...` 通过。

## 下一步

- [ ] 将真实 Runner adapter 接入 Edge Run lifecycle。
- [ ] 后续按需要评估 SQLite 持久化方案。
