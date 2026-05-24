# Stale Docs Audit - 2026-05-25

本文件记录本轮审计中发现的根 `docs/` 旧内容。受任务写入范围限制，未移动、改写或删除这些文件。

## 审计基准

当前架构以 `docs/system-architecture.md` 为准：

- Hub / Edge / Desktop 三层。
- Edge 是本地、远程或云端执行节点。
- 独立根目录 `runner/` 已废弃；执行能力位于 `edge-server/internal/lifecycle/` 和 `edge-server/internal/adapters/`。
- Agent Runtime、Agent Profile、Agent Configuration、Execution Target 是当前术语边界。
- UI 不直接访问 Runner 或 Agent CLI。

## 建议改写或归档

| 文件 | 建议 | 原因 |
|---|---|---|
| `docs/client-roadmap.md` | 建议改写后保留，或完成后归档。 | 文件仍将客户端方向描述为 Desktop、Runner、Local Edge 调度，接口表包含 `GET /v1/runners`，允许修改范围包含 `runner/**`，验证命令仍进入 `..\runner`。这些内容与独立 Runner 已废弃的当前事实冲突。 |
| `docs/client-handoff.md` | 建议移动到 `docs/archive/` 或改写成当前 Desktop 接手指南。 | 文件指向旧分支 `feat/client-dev` 和 PR #26，结构中列出 `runner/` Go Mock Runner，启动方式要求单独运行 `agenthub-runner --mock`，测试说明围绕 RunnerList 和 Mock Run。更像 2026-05-22 的历史交接快照。 |

## 建议局部清理

这些根文档仍是当前主文档或状态文档，不建议归档，但其中部分措辞需要后续 owner 统一更新：

| 文件 | 建议 | 原因 |
|---|---|---|
| `docs/product-requirements.md` | 局部替换 Runner 表述。 | 当前产品需求仍多处写 Real Runner、Runner 启动真实 CLI、Cloud Runner、Runner 输出等。产品表达可保留“执行能力”，但应改为 Edge lifecycle + AgentAdapter 或 Execution Target。 |
| `docs/implementation-guide.md` | 局部替换章节标题和职责描述。 | 已有说明说 Runner 已整合进 Edge，但仍有“客户端负责 Desktop、Runner、Edge 本地调度”“Runner Manager”“Runner 输出不要逐行直接刷 UI”等旧称呼。建议统一为 Edge execution lifecycle / AgentAdapter。 |
| `docs/handoff/desktop-agent.md` | 后续接手前复核。 | 该 handoff 标题仍称 Hub-Edge-Runner 三层，并保留 RunnerList、`runner.online/offline` 等旧 UI 事件表述。 |
| `docs/handoff/edge-server-agent.md` | 后续接手前复核。 | 该 handoff 同时记录 Runner registry 废弃和旧 `--runner-profile` 兼容信息。作为接手材料可保留，但需标明兼容项与当前主线的边界。 |
| `docs/design/integration.md` | 后续接口统一时复核。 | 仍列出 `/v1/runners` 和 `Runner` 数据对象。若当前 UI 改为 Agent/Profile/Runtime 列表，应同步 API 术语。 |

## 不建议本轮处理

| 范围 | 原因 |
|---|---|
| `docs/roadmap.md`、`docs/roadmaps/` | 用户明确禁止编辑。 |
| `docs/system-architecture.md` | 已有并行修改，本轮只读不写。 |
| README、AGENTS、App/前端代码 | 用户明确禁止编辑。 |
| 物理移动根 docs 文件 | 用户要求只记录建议，不擅自移动。 |

## 后续处理顺序建议

1. 先由架构 owner 确认 `/v1/runners` 是否作为兼容 API 保留，还是改名为 Agent Runtime/Profile 列表。
2. 再改 `docs/product-requirements.md` 和 `docs/implementation-guide.md` 的用户可见术语。
3. 然后决定 `docs/client-roadmap.md` 和 `docs/client-handoff.md` 是归档还是改写为当前客户端接手指南。
4. 最后同步 `docs/handoff/*` 和 `docs/design/integration.md` 的旧 Runner 事件、列表和 API 名称。
