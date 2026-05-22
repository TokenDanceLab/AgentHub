# 后端路线图

最后更新：2026-05-23

## 负责范围

- Hub Server
- Edge-Hub 通信
- 账号、群聊、同步、中继
- API 契约维护

## 当前目标

围绕 Hub-Edge-Runner 主线，先把 Hub / Edge 的接口边界和同步模型写稳，再逐步实现服务。

## 近期任务

- [ ] 补齐 Hub Server health、device registry、sync 占位接口。
- [ ] 明确 Edge-Hub event ack 和断线恢复字段。
- [ ] 审查 `api/openapi.yaml` 是否覆盖后端 M2/M3 需要的 endpoint。
- [ ] 为 Hub / Edge 通信定义最小集成测试方案。

## 依赖

- `api/openapi.yaml`
- `api/events.md`
- `docs/system-architecture.md`
- `docs/implementation-guide.md`

## 验收

- [ ] `go test ./...`
- [ ] YAML 校验通过。
- [ ] API 变更同步到 `api/README.md` 或相关说明。
