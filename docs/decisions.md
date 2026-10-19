# AgentHub Decisions

最后更新：2026-10-18

记录当前仍约束实现的跨切决策，每条一句话。ADR 编号留给历史追溯，不为已完成工作补写新 ADR。

| ID | 当前结论 |
|---|---|
| ADR-001 | Hub/Edge 双层：Hub 负责账号、IM、同步、路由、审计；Edge 负责本地执行、adapter、workspace、事件和本地持久化。 |
| ADR-002 | 运行事件走 typed WebSocket event stream；CLI NDJSON/JSONL 只在 Edge adapter 内解析，REST 负责查询和普通 RPC。 |
| ADR-003 | 服务端状态使用 TanStack Query，客户端 UI 临时状态使用 Zustand；实现以 `app/shared` 和各端当前代码为准。 |
| ADR-004/007 | Edge 用 Go `os/exec` + AgentAdapter/Registry 管理 runtime；新增 runtime 只通过 adapter 接口接入，前端不感知 CLI 差异。 |
| ADR-006 | Agent 间协作以 Hub typed TeamAssignment / TeamRun 为事实源；IM message 只是人可读投影，不作为 Agent 决策输入。 |
| ADR-008 | 设计 token 化；当前共享设计合同以 `docs/architecture/07-design-system-ssot.md`、OKLCH/CSS Modules 和 `--td-*` intent 为准。 |
| ADR-010 | Edge 暴露 MCP-compatible capability 时只做 narrow tool surface；不为每个外部工具做专用协议。 |
| ADR-011 | 前端保持 pnpm workspace / shared package 架构；Desktop/Web/Mobile 共享类型和 UI contract，平台能力留在各端 adapter。 |
| ADR-015 | 服务间禁止循环依赖；优先窄接口、构造函数显式依赖和事件中介，不用 setter 注入掩盖循环。 |
| ADR-016 | Hub→Edge dispatch 必须有 delivery outbox / ACK / retry / dead-letter 语义，禁止 fire-and-forget 造成状态永久分歧。 |
| ADR-017 | 授权区分身份令牌和 per-run capability token；真实安全边界以当前 JWT/capability 实现为准。 |
| ADR-018 | 仓库根布局保持 README/AGENTS/LICENSE/go.work/.github 与根级 CI/编辑器配置，不做 bulk move。 |
| ADR-019 | WebSocket 事件流走单一 bus 抽象；reconnect 补数据、dispatch、停机广播、jitter、CAS 由 bus 统一承担。 |
| ADR-020 | execution target `target_type` 的 DB CHECK 与 service/route 取值集合同名同序，组合约束留在 service 层。 |
| ADR-022 | 已发布迁移不可变；修复通过后续迁移旁路旧触发器，新迁移使用幂等语法；legacy 数据另走 backfill。 |
| ADR-023 | Tauri 安全加固：sidecar 重启策略、最小权限 command capability、出站 URL allowlist 与私网拦截。 |
| ADR-024 | `hub-server/internal/service/` 与 `edge-server/internal/adapters/` 按领域/Agent 家族拆子包；新领域逻辑不再回平铺包。 |
| ADR-025 | 双平面：Hub 是控制面、不执行模型 Turn；Edge 是数据面并产生证据；详见 `docs/architecture/10-macro-engineering-design.md`。 |
| ADR-026 | 自有 REST/WS 是产品契约 SSOT；MCP/A2A/AG-UI 只做 capability mapping；事件一致性与最小代理权进入实施合同。 |
| ADR-027 | OTel GenAI 命名口径：GenAI span 使用 `agenthub.run*` / `gen_ai.*`；不为 WS 帧、DB/Redis 建 GenAI span。span 导出尚未落地，落地时按此口径。 |
| ADR-028 | secret 门禁由 `gitleaks` 默认规则集承担，仓库只维护 `.gitleaks.toml`；夹具只允许 `condition = "AND"` 的精确 `(path, literal)` 放行，禁止目录/glob/包级豁免。 |
| ADR-029/035 | Web 的 Query key 唯一产出点是 `app/shared/src/stores/queryKeys.ts`；键工厂必须有消费者；失效只引用工厂；Web 使用 `webQueryKeys`。Desktop 的 Hub query keys 尚未迁移，按同一规则逐步收敛。 |
| ADR-030 | 对外契约：`x-agenthub-owner` 只用 Hub/Edge；端点级 `x-agenthub-status` 只取 implemented/planned，schema 级另允许 contract-draft；Mobile 是 fixture 边界验证，非 release candidate。 |
| ADR-031 | 分页超过声明上限时夹到上限并回传 `nextCursor`/`hasMore`，不返回 400；被夹短的页仍可续取。 |
| ADR-032 | CI 测试按路径矩阵并行分片；Windows production build 必须保留。 |
| ADR-033 | regenerate 的 identity 是 task id；不从 message id / client_msg_id 猜 task id；demo 和未登录端 fail-closed、零请求。 |
| ADR-034 | Project lifecycle 只由服务端契约定义；后端没有 status 字段时，前端不发明筛选或状态标签。 |
| ADR-036 | Browser preview：`frame-src` 放行任意 https 与 loopback http；HTML/远程 iframe 用 `sandbox=allow-scripts`（不含 `allow-same-origin`）；PDF 由浏览器 viewer 渲染，不加 sandbox。 |
