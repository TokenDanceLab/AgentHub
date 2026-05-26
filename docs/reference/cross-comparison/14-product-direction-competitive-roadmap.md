# AgentHub 产品方向竞品研究与长期路线

> 状态：2026-05-26 研究结论，面向 AgentHub P0-P4 产品路线。
> 范围：产品定位、两个 Home、Runtime 工作台、AgentTeam、远程/云执行、Agent Platform、企业治理。

---

## 0. 结论

AgentHub 最有价值的方向不是再做一个聊天客户端、Agent CLI 外壳、低代码 workflow 画布或纯云端 autonomous SWE，而是：

```text
Local-first multi-runtime Agent command center
  + Hub-governed collaboration fabric
  + Target network for Local / Remote / Cloud Edge
```

这条路线把 AgentHub 和竞品拉开：

- 比 Cherry Studio / LibreChat / LobeHub 更接近真实工程执行，因为 AgentHub 有 Edge、真实 CLI Runtime、workspace、RunEvent、Artifact 和审批。
- 比 AionUI 更适合多端和团队，因为 AgentHub 有 Hub、TokenDance ID、owner boundary、Web Hub-only、Execution Target 和审计路线。
- 比 OpenHands Cloud 更适合本地优先和多 Runtime，因为 AgentHub 不只做 hosted sandbox，也不绑定单一 agent runtime。
- 比 Dify / Flowise / LangGraph 更适合 IM-native 工程协作，因为 AgentHub 的主对象是 Thread / TeamRun / Run，而不是 canvas workflow。

长期产品主线应收敛成一句话：

```text
用户输入目标 -> 选择 AgentTeam/Profile/Target -> 观察真实 Runtime 执行 -> 审批/比较 Artifact -> 任意端恢复和审计
```

当前仓库已经有不少地基，但产品还没有达到这个叙事：

- 两个 Home 还没有完全变成 operational console。
- RunEvent 已有 Hub typed persistence，但 typed blocks、step grouping、artifact、approval、usage 摘要还没一等化。
- AgentTeam/TeamRun 还缺产品级模型。
- Execution Target 已有 owner boundary、allowlist 和 inventory，但 `target_id` dispatch、remote/cloud routing、远程审批未完成。
- Agent Market、Skill/MCP、model mapping、cc-switch、scheduler 还没有统一成 Hub-managed Agent Platform。

---

## 1. 竞品分层

| 类型 | 代表 | 优势 | AgentHub 不应照搬 | AgentHub 应采纳 |
|---|---|---|---|---|
| 多 provider 聊天客户端 | Cherry Studio、LibreChat | 设置/Provider/MCP/会话 UI 成熟，用户上手快 | renderer/local store 做 SSOT，provider secret 前端持久化，聊天壳优先 | Settings primitives、typed blocks、tool group、provider health、artifact preview |
| Agent workspace / local desktop | AionUI、OpenCode Desktop、Goose Desktop | 本地多 Runtime、Team Mode、自动发现、定时任务、远程访问 | 本地 SQLite/进程内状态承担团队事实源，默认 full-auto | local-first runtime UX、Team task board、per-agent approval、scheduler ergonomics |
| 云端 autonomous SWE | OpenHands Cloud/Enterprise | SDK/CLI/Local GUI/Cloud/Enterprise 分层清楚，sandbox、multi-user、sharing/RBAC 明确 | Cloud-only 或把本地 P0 和云 P3 混成一个完成口径 | Local/Cloud 分层、企业审计、conversation sharing、target lease |
| Agent/workflow 平台 | Dify、Flowise、LangGraph/CrewAI | workflow、tool、dataset、admin、process 概念成熟 | canvas-first、workflow-first、把 IM 降级成触发器 | durable run/event、Supervisor typed route、ToolRegistry、模板导出 |
| AI IDE / CLI runtime | Codex、Claude Code、OpenCode、Goose | 原生编码能力强，CLI/SDK 升级快 | 把 Runtime 私有 role 当产品 Agent，或把 UI 绑定到单 runtime | AgentAdapter、runtime capability projection、profile abstraction、control protocol |

---

## 2. AgentHub 当前产品资产

### 2.1 已经形成差异化的资产

| 资产 | 价值 |
|---|---|
| Edge Server + AgentAdapter | 真正启动 Codex / Claude Code / OpenCode，而不是只做聊天代理。 |
| typed RunEvent / EventStore | 可以把 transcript、tool timeline、diff、artifact、approval、usage 统一投影。 |
| Hub task bridge | Web -> Hub -> Desktop -> Local Edge -> Hub stream 已有仓内最小闭环。 |
| TokenDance ID + Hub session | 身份 SSOT 和产品 session 分层已经建立。 |
| Web Hub-only boundary | 浏览器不直连 Local Edge，后续远控和云执行更容易管权限。 |
| Execution Target model | owner boundary、workspace allowlist、health/inventory 是远程/云 target 的安全地基。 |
| Runtime/Profile/Configuration/Target 分层 | 可以管理“谁做事、用什么运行、按什么规则、在哪里执行”。 |

### 2.2 产品叙事仍弱的地方

| 缺口 | 为什么重要 |
|---|---|
| Home 不是运行控制台 | 用户第一眼看不到 active runs、pending approvals、target health、recent artifacts 和失败 handoff。 |
| Artifact lifecycle 不完整 | Agent 产出的 diff、截图、报告、部署 preview 还没有统一 apply/discard/provenance。 |
| Blocking HITL 未完成 | 审批展示不能替代 Runtime stdin/control 回写、timeout、deny、resume 和审计。 |
| AgentTeam/TeamRun 未产品化 | 当前只能说有多 Agent 基础，不是可恢复、可审计、可编排的团队协作。 |
| Agent Platform 还分散 | Profile、Skill/MCP、model mapping、cc-switch、Market、Scheduler、Audit 还没有统一工作台和 Hub store。 |
| Remote/Cloud Edge 仍是规划 | 8 场景里 3/4/5/6/8 仍缺 target routing、relay、allowlist sync、remote approval、cloud lease。 |
| Run 可复现性不足 | Profile / model route / runtime version / Skill/MCP 版本 / target / approval policy 还没有固化成每次 Run 的 `RunConfigSnapshot`。 |

---

## 3. 产品北极星

AgentHub 的北极星不是“模型聊天更好看”，而是“真实 Agent 工作可见、可控、可恢复、可协作”。

### 3.1 核心对象

```text
Workspace
  -> Thread
    -> AgentTeam / AgentProfile
      -> ExecutionTarget
        -> TeamRun / Run
          -> RunEvent / TeamEvent
            -> Approval / Artifact / AuditEvent
```

### 3.2 首屏承诺

Desktop Home 和 Web Home 都应是 action-first operational console：

| Surface | 第一屏必须回答 |
|---|---|
| Desktop Home | 本机 Edge 是否可执行？哪些 run/teamrun 正在跑？哪些审批等我？哪些 artifact 可审查？哪些 target/workspace 有风险？ |
| Web Home | 我是否登录 Hub？哪台 Desktop/Remote/Cloud target 在线？我能远程审批什么？最近 TeamRun 到哪一步？是否有 session/OIDC 风险？ |

不应出现：

- 营销型 hero 盖住工作状态；
- 静态 feature card 冒充真实 inventory；
- Web 重新直连 Local Edge；
- 把 Codex/Claude Code/OpenCode 写成用户要管理的业务 Agent 本体；
- 把远程/云 target 写成已完成。

### 3.3 产品四根柱子

| 柱子 | 目标 | 关键证据 |
|---|---|---|
| Runtime Workbench | 真实 Runtime 的事件、工具、diff、artifact、approval 全部可见可控 | typed blocks、RunStepGroup、blocking HITL、artifact lifecycle |
| AgentTeam Collaboration | 多 Profile 围绕同一目标协作，可恢复、可审计、可比较 | AgentTeam、TeamRun、TeamTask、TeamEvent、TeamRunState |
| Target Network | 本地、远程、云执行目标成为可选择、可授权、可审计的网络 | target_id dispatch、relay routing、remote approval、cloud lease |
| Agent Platform | Profile、Skill/MCP、model mapping、Market、Schedule、Audit 成为 Hub-managed 资产 | Hub store、masked provider metadata、ToolRegistry、template install |

---

## 4. 两个 Home 的产品路线

### 4.1 Desktop Home

Desktop Home 应优先服务本机执行和人类审查：

- Local Edge health：runtime availability、workspace allowlist、event cursor、auth token 状态。
- Active Runs / TeamRuns：状态、elapsed、current step、target、profile/team。
- Pending approvals：risk、scope、requested by、timeout、allow/deny。
- Artifact review queue：diff、file change、screenshot、report、preview、apply/discard。
- Target readiness：local、remote、cloud、relay target 的在线/权限/allowlist。
- Recent failures：runtime offline、target route failed、approval timeout、workspace denied。
- Quick start：选择 workspace、profile/team、target，启动 run/teamrun。

### 4.2 Web Home

Web Home 应优先服务远程查看、审批和多端恢复：

- Hub session / TokenDance ID status。
- 当前用户可见 Desktop / Remote / Cloud target inventory。
- Active TeamRuns / assigned approvals。
- Recent artifacts and audit hints。
- Device reconnect / logout / OIDC callback warnings。
- Deep link 到 AgentHub workspace，而不是执行 Web 本地 runtime。

### 4.3 设计边界

- Home 可以引用官网/产品站，但第一屏不能像 landing page。
- 空态也要是可操作空态：connect Desktop、create Profile、register Target、open Workspace。
- 所有 remote/cloud 行为必须展示 target、workspace、approval policy 和 audit owner。

---

## 5. Agent Platform 路线

Agent Platform 不等于“Agent 市场页面”。它应该是 Hub-managed 的配置和治理层：

| 模块 | 首版 |
|---|---|
| Agent Profile store | Runtime + model alias + permission + tool allowlist + target preference，可跨端同步。 |
| RunConfigSnapshot | 每次 Run 固化 runtime version、profile/config version、model route、Skill/MCP version、target、approval policy 和 resolver 结果。 |
| Team template | 多 Profile 组合、role、budget、concurrency、approval、target policy。 |
| Skill catalog | 本地 skill discovery + Hub metadata + enable/disable + version/audit。 |
| MCP registry | server metadata、OAuth 状态、tool allowlist、session health，不存真实 secret。 |
| Model mapping | `ModelSpec` / `ModelRoute` 解析 opus/sonnet/haiku 等别名，展示 provider/model、context、tool/vision/reasoning、runtime args 和风险。 |
| Provider binding / cc-switch | AgentHub 引用 binding id、健康、配额、fallback 策略和 masked metadata；真实 key 留在 cc-switch 或安全存储。 |
| Tooling registry | Skill 和 MCP 在 UI 上合成一个可用工具视图；底层仍区分 instruction/script package 与 tool service。 |
| Scheduler | Hub owns schedule，Edge claims execution lease，Channel 只做 ingress/egress。 |
| Audit | Profile/Target/Skill/MCP/provider/approval/run/artifact 全部可查。 |

### 不做

- 不把 provider key、真实 workspace path、raw env 放进公开 Profile 或前端持久化。
- 不让 Feishu/Lark 或其他 channel 成为第二套登录系统。
- 不把 Market 做成 prompt gallery；首版应是可执行 Profile/Team template + readiness check。
- 不把 cc-switch 变成 AgentHub 自己的密钥系统；AgentHub 只做 provider binding 引用、解析和审计。

---

## 6. Remote / Cloud Edge 路线

8 个场景不应继续用“工程里有预留”来冲完成率。Remote/Cloud 应拆成五个阶段：

| 阶段 | 内容 | 关闭的场景 |
|---|---|---|
| Target contract | `target_id` dispatch、owner boundary、workspace allowlist、target health、deleted state | 3/4/5/6/8 的共同地基 |
| Target-bound routing | Hub route 绑定 `target_id -> device_id/edge_id`，pending queue 按 target 隔离，不 fallback 到第一个 Desktop | 4/7 |
| Remote Edge proof | 设备证明、远程审批、allowlist sync、audit buffer、Tailscale/SSH/Relay target | 3/4 |
| Cloud Edge lease | cloud target provisioning、lease、quota、tenant isolation、secret boundary | 5/6/8 |
| Artifact/Preview proxy | artifact metadata sync、content policy、preview proxy、apply/discard 权限 | 3-8 |

原则：

- Web 永远通过 Hub session，不直连 Runtime。
- Hub 调度和审计，不直接启动 CLI。
- Edge 执行，必须受 target/workspace/profile/approval policy 限制。
- Cloud Edge 是 P3/P4，不影响 P0 本地离线完成口径。

### 6.1 8 场景到 P2-P4 的验收表

| 路线 | 覆盖场景 | 目标 | 首批验收 |
|---|---|---|---|
| P2A Identity / Session evidence | 2、7 | Desktop 本地在线和 Web 中继当前 Desktop 从仓内 wiring 变成部署态证据 | login/logout/reconnect、Hub WS auth、Desktop/Web callback UX、Web 高信任 session、截图和 smoke |
| P2B Enterprise foundation | 2、7 的团队化基础 | user/org/project/workspace/team membership、role/permission key、Profile/Configuration Hub 持久化、audit schema | Hub-local resource/action check 覆盖 org/project/thread/run/profile/target/integration，前端 permission key 只做展示不做唯一门禁 |
| P3A Registered Remote Edge | 3、4 | 用户自己的远程 Desktop/Edge 成为可注册、可路由、可审批的 Execution Target | Edge target 注册、device proof、target health、workspace allowlist sync、target-bound dispatch、remote approval、preview/artifact proxy |
| P3B Cloud Edge lease | 5、6、8 | Cloud Edge 成为受租户隔离、资源限额和凭据边界约束的 target | Cloud workspace provider、WorkspaceSpec、status state machine、startup grace、session key、quota、exposed URL policy |
| P4 Team Platform | 3-8 的团队化能力 | AgentTeam、Team template、Agent Market、Skill/MCP、审计、组织治理统一 | TeamRun 跨 Local/Remote/Cloud target，Hub 可 replay TeamEvent，artifact/approval/audit 可追溯 |

P2 的核心不是“登录按钮已经接上”，而是 Hub session/device proof + Hub-local 授权 + 审计证据闭环。P3 的核心不是“能 SSH 跑命令”，而是 Execution Target 产品化：注册、健康、路由、workspace policy、远程审批、preview/artifact proxy。P4 再做团队/企业完整治理，不应把复杂 SCIM、策略语言或计费系统提前塞进 P2。

---

## 7. 长期 Roadmap

### P0. Evidence and Runtime Surface

目标：把当前真实 Runtime 能力变成用户看得懂、可复测的产品面。

- `feat/runtime-event-blocks-ui`：RunBlock / RunStepGroup union，tool、terminal、file_diff、approval、artifact、usage、error 共用渲染。
- `feat/artifact-lifecycle`：Edge event -> Hub index -> Web/Desktop preview -> apply/discard 权限。
- `feat/blocking-approval-control`：Runtime stdin/control 回写、timeout、deny、resume、audit。
- `feat/operational-home-console`：Desktop/Web Home 显示 active runs、approvals、target health、recent artifacts、session warnings。

### P1. AgentTeam and Productized Collaboration

目标：从“可放多个 Agent”升级成“可恢复的团队协作”。

- `feat/agentteam-contract`。
- `feat/teamrun-state-router`。
- `feat/teamrun-local-smoke`。
- `feat/teamrun-console-ui`。
- `feat/team-artifact-conflict`。

### P2. Agent Platform

目标：把 Profile、Skill/MCP、Model Mapping、Market、Scheduler、Audit 收敛到 Hub-managed 资产。

- `feat/profile-store-hub-sync`。
- `feat/run-config-snapshot`。
- `feat/skill-mcp-registry`。
- `feat/model-mapping-ccswitch-binding`。
- `feat/team-template-market`。
- `feat/scheduler-edge-lease`。
- `feat/audit-console`。

### P3. Target Network

目标：完成远程 Desktop 和 Cloud Edge 的真实产品链路。

- `feat/hub-target-id-dispatch-contract`。
- `feat/hub-edge-target-routing`。
- `feat/remote-edge-proof`。
- `feat/cloud-edge-lease`。
- `feat/artifact-preview-proxy`。

### P4. Enterprise / Organization

目标：让团队能安全采用，而不是只适合个人本机试用。

- org/workspace roles；
- resource/action authz；
- Profile/Team/Target policy templates；
- audit export；
- retention and memory visibility；
- SSO/OIDC admin readiness；
- billing/quota/usage envelope；
- release gates for security risks。

---

## 8. 下一步推荐

当前最应该并行推进三条线：

1. **Home + RunEvent surface**：先让真实能力在两个 Home 和 RunDetail 里可见，否则产品看起来还是普通聊天。
2. **AgentTeam contract**：把多 Agent 的产品对象立起来，避免继续让 Edge runtime 原型承担产品语义。
3. **Target dispatch contract**：把 8 场景缺口转成 `target_id` dispatch 和 routing，而不是继续讨论远程/云大概念。

这三条线互相解耦，可以分别开 worktree；共同约束是 Web Hub-only、TokenDance ID 身份 SSOT、Hub-issued session 授权、Execution Target owner boundary 和 secret-free docs。
