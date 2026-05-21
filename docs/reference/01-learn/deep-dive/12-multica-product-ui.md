# Multica 产品与 UI 深入分析

日期：2026-05-21

目的：精确定义 AgentHub 应从 `reference/multica/` 学习什么，以及什么必须保持不同。

## 1. 为什么 Multica 是 Tier-0 参考

Multica 是 AgentHub 长期形态最接近的参考之一，因为它将编程 agent 视为真正的产品角色，而非隐藏的 CLI 调用。

证据：

- `reference/multica/README.md:31-35` 表示 agent 可以像同事一样被分配工作，更大的团队可以将工作路由到 squad。
- `reference/multica/README.md:55-62` 列出了完整生命周期：agent 队友、squad、自主执行、可复用 skill、统一运行时和多工作区隔离。
- `reference/multica/docs/product-overview.md:95-121` 给出概念词典，其中 Agent、Runtime、Daemon、Task、Skill、Chat 和多态 actor 直接映射到数据库概念。

因此 AgentHub 应将 Multica 作为以下方面的主要参考：

- agent 身份与状态
- runtime / daemon 注册
- task 队列生命周期
- 进度与阻塞报告
- skill 挂载
- 精致、紧凑、克制的产品前端设计

## 2. 产品映射

| Multica | AgentHub |
|---|---|
| Agent 是一等队友 | Agent 作为 conversation、审批、artifact 和运行历史中的一等角色出现 |
| Issue 是核心工作对象 | Conversation / Thread / Artifact 是核心对象 |
| Task 是一次 agent 执行 | AgentRun 是一次 agent 执行 |
| Runtime 是 agent 可执行的环境 | RunnerEndpoint / AgentCapability 描述 CLI agent 可在何处、如何运行 |
| Daemon 轮询服务器并运行 CLI agent | Edge 管理本地/远程 Runner 可用性并分发 RunnerCommand |
| Squad 将工作路由到一组 agent | Group chat + Orchestrator / Coordinator 将工作路由到 agent |
| Chat 是 1:1 侧边栏 | Chat 是主产品界面，包括 group chat 和 `@Agent` |
| Progress 通过 WebSocket 流式传输 | EdgeEvent / RunnerEvent 流式传输到 UI 并持久化到 EventStore |

边界：

```text
学习 Multica 的 agent 生命周期。
不要复制 Multica 的 Issue/Board 优先入口。
```

## 3. 值得学习的前端结构

Multica 的前端组织方式尤其有参考价值，因为它将平台胶水与可复用产品视图分离。

证据：

- `reference/multica/AGENTS.md:15-20` 划分了 `server/`、`apps/web/`、`apps/desktop/`、`packages/core/`、`packages/ui/` 和 `packages/views/`。
- `reference/multica/AGENTS.md:23-35` 规定 React Query 持有服务端状态，Zustand 持有客户端状态，WebSocket 事件使查询失效，共享 views 不能直接导入 Next.js 或 router API。
- `reference/multica/apps/web/platform/navigation.tsx:19-35` 使用 `NavigationAdapter`，使共享 views 不依赖 Next.js。
- `reference/multica/packages/views/` 包含可复用的业务界面，如 agents、chat、issues、runtimes、skills、squads、editor、dashboard、search 和 onboarding。

AgentHub 前端应镜像此边界，适配我们的命名：

| 层 | AgentHub 规则 |
|---|---|
| `apps/web` | 平台路由、app providers、web-only 接线 |
| `apps/desktop` | Tauri 壳、原生桥接、托盘/窗口行为 |
| `packages/ui-kit` | 原子 UI 组件，无业务逻辑 |
| `packages/agent-core` / `packages/im-core` | 类型化客户端模型和业务 hooks |
| `packages/views` 或等效层 | 可复用业务视图：conversation、artifact 面板、runner 状态、审批、设置 |

## 4. 实时状态流转

Multica 有一条有用的规则：WebSocket 不应成为前端的第二个数据库。

AgentHub 应将此写为前端契约：

```text
Edge / Hub EventStore 是持久化数据源。
生成的 TypeScript 事件类型是前端契约。
WebSocket 传递通知和流式 Item。
每个持久化对象有一个所有者 store/query。
派生面板从该所有者读取，不从重复的本地副本读取。
```

实操映射：

| 对象 | 前端所有者 |
|---|---|
| Project / Conversation / Thread | query cache 或 conversation store |
| Turn / AgentRun 状态 | run store 或 query cache，由类型化事件驱动 |
| Item 流 | 仅追加的 thread item 流，按 event id 去重 |
| Approval 请求 | approval store，按 approval id 键控 |
| Artifact 元数据 | artifact store，按 artifact id 键控 |
| Preview URL | 从 artifact/run 元数据派生的预览路由状态 |

## 5. 值得学习的视觉体系

Multica 的 UI 给人强烈的感觉，因为它克制而紧凑，而非装饰性强。

证据：

- `reference/multica/docs/design.md:7-13` 定义了克制的 UI、中性层次和基于 token 的一致性。
- `reference/multica/docs/design.md:78-103` 将排版限制在小号范围，避免厚重的字重。
- `reference/multica/docs/design.md:107-133` 使用 4px 间距网格，将卡片作为最重的分隔工具。
- `reference/multica/apps/web/app/globals.css:1-6` 组合了 Tailwind、shadcn、tokens、base 和自定义 CSS 层。

AgentHub 应采纳以下 UI 规则：

- 使用紧凑的三栏工作台，而非营销着陆页
- 大部分 UI 区域使用中性表面
- 颜色仅用于状态、风险、agent 标识和选中态
- 排版保持小而一致
- 卡片仅用于实际重复对象、审批和模态框
- agent 状态、runtime 状态和 run 进度在不喧宾夺主的前提下可见

## 6. 后端 / Runtime 映射

Multica 同样有用，因为它的后端是 Go，且其执行模型接近 Hub-Edge-Runner。

证据：

- `reference/multica/README.md:116-126` 说明 daemon 自动检测 CLI agent 并注册一个 runtime，用于创建 agent。
- `reference/multica/README.md:170-175` 列出了 Go 后端、PostgreSQL、WebSocket 和本地 daemon runtime。
- `reference/multica/server/internal/` 包含 runtime、daemon、handler、realtime、service 和 metrics 包。
- `reference/multica/server/pkg/protocol/events.go` 定义了 task 和 daemon WebSocket 事件。

AgentHub 映射：

| Multica Backend | AgentHub Go Service |
|---|---|
| Server 元数据 | Hub Server 负责账号/同步/中继，Edge Server 负责本地项目/run 授权 |
| Daemon | Edge 管理的 Runner 可用性 |
| Runtime | RunnerEndpoint / AgentCapability |
| Task queue | AgentRun queue |
| Task progress events | RunnerEvent -> EdgeEvent -> UI |
| Agent provider files | Runner adapter packages 用于 Claude Code / Codex / OpenCode |

## 7. 不应复制的部分

不要直接复制以下部分：

- Issue 和 Board 作为首屏。
- Chat 仅作为私密 1:1 侧边栏。
- Server 拥有所有执行权限。
- 产品语言中隐藏 IM/群组协作。

AgentHub 的产品句应保持为：

```text
像飞书/微信一样的多 agent 编程协作：将 Claude Code、Codex 和 OpenCode 拉入群聊，让它们处理文件、审查 diff、请求审批并交付 artifact。
```

## 8. 具体的 AgentHub 变更

架构文档应反映以下补充：

- 产品模型包含 `Multica 风格的托管 agent 生命周期`。
- `AgentProfile` 在模型中是强制性的，而非可有可无的装饰。
- `AgentRun` 状态机包含 queued、running、awaiting approval、done、failed 和 cancelled。
- Runtime/Runner 状态在顶栏或右侧面板中可见。
- Progress、blocker 和 error 成为一等 Thread Item。
- UI 数据流规定 WebSocket 事件不直接修改随机 store。
- 设计系统应偏向紧凑、中性、状态驱动的 UI。
