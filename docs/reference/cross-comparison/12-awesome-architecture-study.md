# awesome-architecture 架构判断研究与 AgentHub 优化建议

最后更新：2026-05-26

来源：[`study8677/awesome-architecture`](https://github.com/study8677/awesome-architecture)，本次阅读到 `15aeaad`（新增 Claude Code / Codex / OpenClaw / Hermes Agent 模板）。

本文是参考研究文档，不是实现完成证明。它用于把外部架构判断方法论拆解成 AgentHub 可采纳的设计原则、ADR 候选和后续实现队列。不要在本文写入本地 clone 路径、生产 endpoint、真实 token、私有日志或任何脱敏前证据。

## 1. 为什么值得纳入 AgentHub 参考库

`awesome-architecture` 的价值不在具体代码，而在统一训练“架构判断”的方法：

```text
需求 -> 约束 -> 质量属性 -> 候选方案 -> 取舍 -> 决策 -> ADR -> 演进
```

这正好补 AgentHub 当前的结构性问题：Runtime adapter、Hub/Edge、TokenDance ID、Execution Target、RAG/Memory、权限审批和 Web/Desktop/Hub 多端链路已经快速推进，但有些关键分叉仍停留在 roadmap 口径，缺少一组“为什么这样选、放弃了什么、何时升级”的轻量 ADR。

对 AgentHub 来说，这个仓库应作为三类参考：

| 参考层 | 用法 | AgentHub 对应位置 |
|---|---|---|
| 架构思考框架 | 每个大决策先写质量属性和约束 | `docs/architecture/`、`docs/architecture/decisions/`（11 篇 ADR） |
| 领域模板 | AI Agent、RAG、向量库、AI 网关、编码 Agent 的取舍参考 | `docs/reference/cross-comparison/` |
| 反模式清单 | 防止“看起来先进”的过度设计 | `docs/roadmap.md`、issue 验收标准 |

## 2. 可直接采纳的核心原则

### 2.1 先问质量属性，再选技术

同一个功能在不同质量目标下会导出完全不同架构。AgentHub 现在最需要显式化的质量属性是：

| 领域 | 首要质量属性 | 不能忽略的取舍 |
|---|---|---|
| Web -> Hub -> Desktop runtime | 可恢复、可观测、低泄露风险 | 浏览器便利性 vs server-owned session |
| Execution Target | 安全、审计、可控 | 远程灵活性 vs workspace allowlist / device proof |
| RAG / Memory | 可溯源、权限正确、召回质量 | 语义召回 vs 隐私/成本/污染风险 |
| Agent Runtime | 任务成功率、上下文有效性 | 自治程度 vs HITL / 沙箱 |
| TokenDance Gateway 调用 | 低附加延迟、key 隔离、计费准确 | 统一入口 vs 单点治理复杂度 |

### 2.2 ADR 应记录“为什么”，不是复述“是什么”

AgentHub 主文档已经描述了当前是什么：Profile、Target、Thread、Run、RunEvent、Approval。缺的是关键决策的可追溯原因。建议新增轻量 ADR 目录，先补以下五份：

| ADR 候选 | 需要回答的问题 | 触发原因 |
|---|---|---|
| ADR-RAG-001 Memory 先 FTS/摘要还是 pgvector | 历史对话、项目规则、长期记忆如何进入 Context Builder | 用户已提出 AgentHub 历史对话 RAG 需求 |
| ADR-SEC-001 沙箱策略与审批策略双轴 | `permission_mode` 是否继续一维表达，还是拆成物理边界 + 流程边界 | Codex/Claude Code 模型都证明一维档位容易混淆 |
| ADR-WEB-001 Web session 存储边界 | sessionStorage accepted risk 还是 BFF/HttpOnly cookie | 公开 Web 发布前必须关闭高信任 session 风险 |
| ADR-TARGET-001 Execution Target 信任模型 | Local / Remote / Cloud / Hub Relay target 如何注册、选择、授权 | 8 个拓扑场景里远程/云还没真实闭环 |
| ADR-RUNTIME-001 Workflow 优先还是 Autonomous Agent 优先 | 哪些 AgentHub 任务可固定工作流，哪些允许自治循环 | 避免把 AgentHub 变成不可控的 workflow canvas 克隆 |

### 2.3 状态和数据模型是最难改的决策

这点对 AgentHub 尤其重要。UI 文案可以改，adapter 参数可以扩，但以下数据模型一旦落地就会成为长期边界：

- `RunEvent` 事件源和 seq/cursor 语义。
- `Approval` 与 pending permission registry 的审计和 replay 边界。
- `ExecutionTarget` 的 workspace allowlist、device proof、trust level。
- `MemoryDocument` / `MemoryChunk` / `MemoryEmbedding` 的权限字段和 source 追溯。
- Hub session 与 TokenDance ID `sub` 映射。

这些模型不要用临时 JSON blob 糊过去。可以先做最小字段，但必须从第一版就带 owner、scope、source、visibility、created_by、created_at 和审计需要的不可变引用。

## 3. 模板拆解与 AgentHub 采纳建议

### 3.1 AI Agent / 工作流平台

外部模板结论：Agent 平台的核心不是“让模型自由发挥”，而是“行动循环 + 工具 + 记忆 + 控制阀”。能用确定性工作流解决时，不应强行使用自主 Agent。

AgentHub 采纳：

- 默认产品路径应是可解释 workflow：IM message -> select Agent Profile -> choose Execution Target -> create Run -> stream RunEvent -> Approval/Artifact projection。
- Autonomous Agent 只用于开放任务，并且必须带最大步数、预算、超时、重复检测和人工审批。
- Orchestrator 应优先做“可观测拆解与聚合”，不要优先做画布式 workflow builder。
- Run 级 trace 是产品能力，不是 debug 附件。Web/Desktop 都应该能回放“模型计划、工具调用、审批、文件变化、输出”。

对当前架构的优化方向：

```text
Profile.approval_policy
  + Target.sandbox_policy
  + Run.budget/timeout/max_steps
  + RunEvent trace
  -> 才能允许更高自治度
```

### 3.2 RAG 知识库

外部模板结论：RAG 的上限取决于检索质量。生产级 RAG 通常需要文档解析、切块、embedding、混合检索、重排和引用溯源。检索内容必须被当作不可信输入。

AgentHub 采纳：

- 不要把“历史对话全量向量化并自动塞 prompt”当成长期记忆。
- 先区分三层：历史搜索、RAG retrieval、durable memory。
- 检索必须先做权限过滤，不能先召回再隐藏。
- 每个注入上下文的片段都要有来源引用，至少能指回 session/message/run_event/doc。
- RAG 检索结果进入 Runtime 前要经过 prompt-injection 标注和工具权限隔离。

建议数据模型：

| 表 / 实体 | 用途 | 必要字段 |
|---|---|---|
| `memory_documents` | 可检索资料源，不一定复制原文 | `id`, `owner_id`, `org_id`, `project_id`, `source_type`, `source_ref`, `visibility`, `content_hash` |
| `memory_chunks` | 检索最小单元 | `id`, `document_id`, `chunk_index`, `text`, `token_count`, `source_span`, `created_at` |
| `memory_embeddings` | 向量索引，可重建 | `chunk_id`, `embedding_model`, `embedding`, `dim`, `version` |
| `memory_suggestions` | 自动长期记忆建议 | `source_ref`, `summary`, `reason`, `status`, `approved_by` |
| `memory_retrieval_logs` | 调试与审计 | `run_id`, `query`, `selected_chunk_ids`, `scores`, `policy_result` |

MVP 口径：

1. Hub PG 先保留 schema 和 FTS 搜索。
2. pgvector 作为可选 extension 启用，不引入独立向量库。
3. 自动沉淀只生成 suggestion，用户或团队 owner 确认后才进入 durable memory。
4. Context Builder 每次注入 top-K 时写 retrieval log，方便解释“为什么这条记忆被喂给 Agent”。

### 3.3 向量数据库 / pgvector

外部模板结论：小规模、已有 PostgreSQL 的系统，先用 pgvector；规模到百万到亿级、带复杂过滤和高并发时，再评估 Qdrant / Milvus / Weaviate 等专用库。

AgentHub 采纳：

- 当前 Hub 已有 PostgreSQL，Memory/RAG 第一阶段不应新增专用向量数据库。
- pgvector 适合做 AgentHub 的“早期语义检索底座”，但不要把向量相似度当成业务相关性。
- 必须保留 BM25/FTS + vector + recency/authority 的 hybrid rerank。只做 cosine top-K 会在专有名词、路径、issue id、错误码上表现差。
- embedding 是敏感索引，权限边界应等同原文，不能作为绕过 ACL 的旁路。

建议排序信号：

```text
final_score =
  vector_similarity
  + keyword_score
  + source_authority
  + recency_decay
  + explicit_pin_boost
  - stale_or_rejected_penalty
```

### 3.4 AI 对话产品

外部模板结论：AI 对话产品的关键资源是模型调用成本和上下文窗口。流式输出、会话历史、RAG、工具沙箱、模型路由和 token 计量都是核心架构问题。

AgentHub 采纳：

- AgentHub 不应把“流式输出/工具调用/文件修改”当卖点，它们是 Runtime 接入门槛；产品卖点应是 IM-native collaboration、Profile/Target、审计和多端运行证据。
- Web/Desktop 的 RunDetail 应展示 token/step/elapsed/approval/artifact 摘要，不只展示文本块。
- Context Builder 需要显式预算：system / AGENTS.md / memory / recent messages / selected artifacts / retrieval / user prompt 各自占用多少。
- 模型路由应从 Profile 的 model mapping 进入，不要让前端临时拼字符串。

### 3.5 AI 网关 / TokenDance Gateway

外部模板结论：AI 网关价值在治理：统一接口、key 管理、限流、计费、故障转移、流式透传和观测。网关不跑模型，也不应泄露上游 key。

AgentHub 采纳：

- TokenDance API key 与 TokenDance ID access token 必须继续严格分层。
- Browser Web 只能拿 Hub session，不能拿 TokenDance API key。
- Hub/Edge 可以持有 TokenDance API key 或引用 provider binding，但必须进入审计。
- 任何 Relay 调用要保留 usage 记录，未来进入 Profile 成本视图。
- 网关链路必须流式透传，不能为了计费/审计缓冲完整输出再回传。

### 3.6 Codex / Claude Code 编码 Agent 模板

外部模板结论：成熟编码 Agent 都把安全边界放在模型指令之外。Codex 强调沙箱模式和审批策略双轴；Claude Code 强调 deny/ask/allow、OS sandbox、context compaction、subagent isolation、MCP/Skill 延迟加载。

AgentHub 采纳：

| 外部模式 | AgentHub 当前对应 | 优化建议 |
|---|---|---|
| 沙箱和审批双轴 | Profile `permission_mode`、Edge permission registry | 拆成 `sandbox_policy` 与 `approval_policy` |
| 内核级/目标级隔离 | Local Edge / future Remote Edge | Target 必须声明 trust_level、workspace_allowlist、network_policy |
| deny -> ask -> allow | Edge permission registry 与 tool allowlist | 增加 rule engine，deny 优先且不可被 Profile 下层覆盖 |
| 子代理独立上下文 | Orchestrator/sub-agent 规划 | 子任务只回灌摘要和 artifact，不污染主上下文 |
| Skills/MCP 延迟加载 | Agent Configuration / Skill/MCP surfaces | Context Builder 按需注入，不要常驻全量 schema |

最重要的产品改名建议：

```text
permission_mode 不是足够精确的产品概念。

应收敛为：
RunSafetyPolicy =
  SandboxPolicy   // 物理能动范围
  ApprovalPolicy  // 何时问人
  NetworkPolicy   // 是否可联网/可访问哪些域
  WorkspacePolicy // 可读/可写路径
```

Profile 可以给默认值，Execution Target 必须做最终强制，Hub 负责远程/团队授权与审计。

### 3.7 Hermes / OpenClaw 常驻 Agent 模板

外部模板结论：长期 Agent 的价值在“记得住 + 学得会”，但默认记忆可以先用 SQLite/FTS5/Markdown 等简单可审查方案；语义检索和自创技能会带来漂移与安全风险。

AgentHub 采纳：

- 先把 memory 做成可审查资产，而不是黑箱向量库。
- `MEMORY.md` / project notes / pinned decisions / approved memory suggestions 比 raw transcript 更适合作为 durable memory。
- 自创 skill 或自动写 memory 必须有人类确认、版本记录和回滚。
- AgentHub 可以借鉴“常驻 assistant”方向，但应保持 Hub/Edge 权威分层：Hub 管团队可见性和同步，Edge 管本机执行与本地上下文。

## 4. 对 AgentHub 当前架构的优化总表

### 4.1 继续坚持的方向

| 当前方向 | 结论 | 原因 |
|---|---|---|
| Hub/Edge 双层 | 继续坚持 | 同时满足本地优先、Web 多端、远控/审计；比纯云或纯本地更适合 AgentHub |
| Profile / Configuration / Target 拆分 | 继续坚持 | 正好对应“谁做、按什么规则做、在哪里做” |
| append-only RunEvent | 继续坚持并加强 | 是 replay、trace、audit、artifact projection 的共同底座 |
| Web Hub-only | 继续坚持 | Browser 不应直接控制 Local Edge 或持有 Relay key |
| IM-native 而非 canvas-first | 继续坚持 | AgentHub 的差异化是群聊/任务协作，不是 Dify/Langflow 克隆 |

### 4.2 需要收紧的架构边界

| 问题 | 当前风险 | 优化建议 |
|---|---|---|
| `permission_mode` 语义太宽 | 权限、沙箱、审批、联网容易混成一个档位 | 拆成 `SandboxPolicy` / `ApprovalPolicy` / `NetworkPolicy` / `WorkspacePolicy` |
| Execution Target 仍偏 UI 预留 | 3-8 远程/云拓扑无法真实闭环 | 先做 registered target + workspace allowlist + trust_level |
| Memory 还只是概念 | 后续容易一口气黑箱向量化 | 先做 approved memory + FTS，pgvector 可选，检索可解释 |
| Context Builder 不够一等 | Profile 配置能进 Runtime，但上下文预算还不透明 | 建 Context Budget 和注入来源 trace |
| ADR 缺失 | roadmap 容易写成完成口径而非取舍记录 | ~~已修复~~：`docs/architecture/decisions/` 已有 11 篇 ADR |
| Web session 仍是发布风险 | sessionStorage 降低持久化但不防同 tab XSS | 发布前落 BFF/HttpOnly cookie 或正式 accepted risk |

## 5. 建议的近期落地顺序

### P0：文档和架构决策先行

1. 建 `docs/architecture/decisions/`，先补 RAG/Memory、Web session、Execution Target、Run safety policy 四份 ADR。
2. 在 `system-architecture.md` 把 `permission_mode` 明确降级为兼容字段，新增 `RunSafetyPolicy` 目标模型。
3. 在 roadmap 增加 Memory/RAG 的分阶段口径：FTS/approved memory -> pgvector hybrid -> 专用检索服务。
4. 把“8 个拓扑场景”的实现状态改成严格证据口径，避免 P3 planned 与“P0-P3 completed”冲突。

### P1：实现入口

1. Hub 增 Memory schema migration，但先不默认 embedding raw transcript。
2. Edge Context Builder 增 `ContextSource` 和 `ContextBudget`，每次 Run 写入本次上下文来源摘要。
3. Profile safety fields 增 `sandbox_policy`、`approval_policy`、`network_policy`、`workspace_policy` 的 schema 草案。
4. Execution Target API 从只读预览推进到 registered local target，先闭合 Local Edge target 的 workspace allowlist。
5. Web/Desktop RunDetail 增 token/step/elapsed/approval/artifact tabs，直接消费 typed RunEvent。

### P2：能力增强

1. pgvector hybrid retrieval + rerank。
2. Memory suggestion review UI。
3. Remote Edge / Hub Relay target 注册和 device proof。
4. Blocking HITL stdin/control protocol bridge。
5. Agent task success evaluation：检索命中率、Run 成功率、审批 replay、防 prompt injection 回归。

## 6. 反模式清单

| 反模式 | 为什么危险 | AgentHub 应避免的表现 |
|---|---|---|
| 把 RAG 当长期记忆 | 向量相似不等于事实正确，历史对话会过期、含隐私、含错误结论 | 自动把所有 transcript 向量化并默认注入 |
| 把 Agent 自主性当先进性 | 自主循环更贵、更慢、更不可控 | 能固定 workflow 的调度也放给模型自由规划 |
| 用一维权限档位解释所有安全 | 物理边界、流程审批、联网、路径权限被混淆 | `permission_mode=bypass` 之类字段一路透传到所有层 |
| 先检索再过滤权限 | 已经把无权数据带入候选和日志 | RAG 在应用层隐藏而不是 DB/query 阶段过滤 |
| Canvas-first 克隆 | 会稀释 IM-native 协作差异化 | 把主入口变成 Dify/Langflow 式画布 |
| 只写完成状态，不写取舍 | 后续 Agent 无法判断旧设计是债还是原则 | roadmap 追加“已完成”但没有 ADR/验证证据 |

## 7. 建议读者怎么使用本文

- 做 Memory/RAG：先读本文 3.2、3.3、3.7，再写 ADR-RAG-001。
- 做权限/审批：先读本文 3.6，再对照 `07-permission-models.md`。
- 做 Execution Target：先读本文 4.2 和 5，再对照 `system-architecture.md` 的 Target 模型。
- 做 TokenDance Gateway：先读本文 3.5，再对照根 workspace 的 Gateway 产品化文档。
- 做 roadmap closeout：把“已实现”改成带证据的状态，避免把参考模板或 UI 预留当实现证明。
