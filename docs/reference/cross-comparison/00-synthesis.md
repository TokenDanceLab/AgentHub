# AgentHub 竞品二次对比研究 — 跨项目模式收敛与采纳路线图

> 分析日期：2026-05-23
> 数据来源：18 份单仓库深度报告 + 12 份源码深度分析 + 4 份 Web 生态调研
> 当前阶段：M3b（多 Agent 协调）→ M4（Project/Worktree/Diff）

---

## 1. 参考项目全景矩阵

18 个项目按 AgentHub 架构契合度排列：

| 项目 | 类型 | 最相关组件 | 契合度 | 核心可采纳模式 |
|------|------|-----------|:---:|---------------|
| **LibreChat** | IM Agent 平台 | Hub Server, 消息树 UI, 子代理调度 | 最高 | buildTree 消息树, Fork/SiblingSwitch, Subagent 递归 |
| **Multica** | Agent 命令中心 | 产品模型, 前端架构, 运行时生命周期 | 最高 | Squad 路由, Agent Live Card, 四触发入口 |
| **Kanna** | 多 Agent Web UI | Desktop UI, 流式渲染, Orchestrator | 高 | 三 Map 状态机, 16ms 去抖广播, 渐进展开 |
| **Claude Code SDK** | Agent SDK | AgentAdapter, 安全管道, Hook 系统 | 高 | 28 Hook + Zod, 23 安全检查, Context Budget |
| **OpenCode** | CLI Agent + Plugin | AgentAdapter 扩展, LLM 路由 | 高 | 19 Hook 插件, 层级权限合并, 24 包分层 |
| **OpenHands** | Sandbox 平台 | Workspace 隔离, Agent 协议 | 高 | 三级沙箱, WebSocket+REST 双协议 |
| **Codex CLI** | 树形 Multi-Agent | Orchestrator 调度, 任务分解 | 中高 | Agent Tree + Path, SQ/EQ 队列 |
| **OpCode** | Tauri 桌面 GUI | Desktop 壳, Checkpoint/Undo | 中高 | Content-addressed Checkpoint, Tauri 插件 |
| **Goose** | Agent 运行时 | Runner 生命周期, 工具执行 | 中 | MCP 集成, 扩展系统 |
| **Claude Code Viewer** | 会话历史 + Diff | EventStore, FTS5, Diff 展示 | 中 | FTS5 trigram + BM25, Progressive Disclosure |
| **CloudCLI** | 多 CLI 管理器 | CLI 自动发现, 插件系统 | 中 | Provider Manifest, CLI 自动检测 |
| **MindFS** | Agent 文件系统 | Workspace 抽象层 | 中 | 虚拟 FS, 路径守卫, 操作审计 |
| **CC Switch** | 模型/Provider 路由 | Model Config, Fallback | 中 | Provider 注册表, Circuit Breaker |
| **Langflow** | 可视化编排 | 可视化工作流 (P2) | 低 | MCP 三级能力链 |
| **Flowise** | Agentflow Supervisor | Agent 监督 (P2) | 低 | Supervisor RouteTool, Sequential Agents |
| **Dify** | Tool Provider 平台 | Tool Marketplace (P2) | 低 | ToolManager match-dispatch |
| **ChatDev** | YAML 配置驱动 | 声明式工作流 (P2) | 低 | YAML 事实源, FIELD_SPECS 元驱动 |
| **Claude Code WebUI** | 最轻 Web 壳 | 轻量参考 | 低 | 最小透传模式 |

---

## 2. 六大跨项目模式收敛

以下 6 个模式在 3+ 参考项目中独立出现，已收敛为 AgentHub 标准化设计。

### 2.1 消息树 + 分支管理

LibreChat、Kanna、OpenCode、Claude Code 都实现了会话分支/分叉。

| 项目 | 实现 | AgentHub 采纳 |
|------|------|-------------|
| LibreChat | `buildTree()` 构建 `{message, children[]}` 树 | **P0** — ThreadPanel 消息树渲染 |
| Kanna | JSONL transcript 复制 + pendingForkSessionToken | **P0** — Thread.fork() API |
| OpenCode | SQLite parent_id 树 + 显式 fork/abort | **P1** — Session 树持久化 |
| Claude Code | `forkSession()` SDK 函数 | **P1** — SDK 集成 |

**结论**：Thread 树模型 + SiblingSwitch UI 是 AgentHub IM 层核心竞争力。

### 2.2 Hook/插件管道

Claude Code (28 hooks)、OpenCode (19 hooks)、CloudCLI (Manifest) 在 Agent 生命周期插入自定义逻辑。

```go
// AgentHub 统一 AgentHook 接口（6 核心 hook）
type AgentHook interface {
    PreToolUse(ctx context.Context, tool string, input map[string]any) (modifiedInput map[string]any, block bool, reason string)
    PostToolUse(ctx context.Context, tool string, result string) (modifiedResult string)
    PermissionRequest(ctx context.Context, tool string, risk RiskLevel) (decision PermissionDecision)
    OnError(ctx context.Context, err error) (action ErrorAction)
}
```

### 2.3 三级沙箱隔离

OpenHands、Codex、Claude Code、OpCode 按风险等级提供不同隔离级别。

| 级别 | 代表 | 隔离强度 | 启动 | AgentHub 场景 |
|:---:|------|:---:|:---:|-------------|
| L1 Worktree | OpCode, AgentHub P0 | 文件系统 | <100ms | 90% AgentRun |
| L2 Process | OpenHands ProcessSandbox | 进程级 | <500ms | 安装依赖/脚本 |
| L3 Container | OpenHands DockerSandbox | OS 级 | 1-5s | 不可信代码 |

详见 [02-decide/04-sandbox-tools.md](02-decide/04-sandbox-tools.md)。

### 2.4 流式协议双模

所有项目使用流式事件，编码方式不同：NDJSON（Claude Code/Codex stdout）、SSE（OpenCode/OpenHands HTTP）、WebSocket（Kanna/AgentHub 双向）。

AgentHub 当前架构正确：WebSocket 主协议 + NDJSON 适配器内透传。

### 2.5 上下文压缩

Claude Code、LibreChat、OpenCode、Codex 独立实现了相似的压缩机制。

```
ContextBudget {
    MaxTokens: 120000
    ReserveRatio: 0.15        // 15% 预留给 system prompt
    CalibrationRatio: 0.1     // EMA 校准
    Strategy: "summarize" | "truncate" | "hybrid"
}
```

### 2.6 渐进式信息披露 UI

Claude Code Viewer、Kanna、CloudCLI 将密集信息分层展示：

| 层级 | 内容 | 展开方式 |
|:---:|------|---------|
| L1 | Agent 头像 + 一句话摘要 | 始终可见 |
| L2 | 工具调用名称 + 状态 | 点击展开 |
| L3 | 参数/结果 | 代码块折叠 |
| L4 | 原始 NDJSON/日志 | "查看原始输出" |

---

## 3. AgentHub 组件 → 参考项目映射

| AgentHub 组件 | 首要参考 | 次要参考 | 避免参考 |
|-------------|---------|---------|---------|
| **Orchestrator** | LibreChat + Codex | Langflow | ChatDev (固定拓扑) |
| **AgentAdapter** | Claude Code SDK + OpenCode | OpenHands | Kanna (wrapper 耦合) |
| **Desktop UI** | Kanna + Multica | OpCode (Tauri) | Flowise (画布优先) |
| **EventStore** | Claude Code Viewer (JSONL+FTS5) | LibreChat (MongoDB) | Dify (Python ORM) |
| **Workspace** | OpenHands (三级) + OpCode (checkpoint) | Codex (OS sandbox) | MindFS (过度抽象) |
| **权限/安全** | Claude Code (23 检查) + OpenHands (容器) | OpenCode (层级合并) | Dify (Python only) |
| **IM 消息模型** | LibreChat (消息树) + CloudCLI (会话) | Kanna (transcript) | Langflow (无消息) |
| **Context Builder** | Claude Code + LibreChat | OpenCode (compact hook) | — |
| **Tool Registry** | Claude Code SDK + Dify | OpenCode (内置) | Langflow (画布绑定) |
| **Plugin/Skills** | CloudCLI (Manifest) + Claude Code (Hook) | OpenCode (Plugin) | Flowise (节点市场) |

---

## 4. 采纳优先级总表

### P0 — M3b 必须（多 Agent 协调）

| # | 采纳项 | 来源 | 影响 | 天数 |
|---|--------|------|------|:--:|
| 1 | `AgentHook` 接口（6 核心 hook） | Claude Code + OpenCode | edge/adapters | 5d |
| 2 | 消息树渲染（ThreadPanel tree） | LibreChat buildTree | app/desktop | 4d |
| 3 | 安全管道（23 检查 → Go） | Claude Code deep-dive | edge/security | 4d |
| 4 | Task 状态: `dispatched` | Multica | edge/lifecycle | 2d |
| 5 | Context Budget 模型 | Claude Code + LibreChat | edge/context | 3d |
| 6 | 流式增量解析器 | Kanna drainingStreams | app/desktop | 3d |
| | **合计** | | | **21d** |

### P1 — M4 重要

| # | 采纳项 | 来源 | 天数 |
|---|--------|------|:--:|
| 1 | WorkspaceProvider 三级沙箱 | OpenHands + OpCode | 5d |
| 2 | Checkpoint/Undo（Turn 边界） | OpCode content_pool | 4d |
| 3 | Agent Live Card | Multica | 3d |
| 4 | Fork 机制（Thread 级） | LibreChat | 3d |
| 5 | 四触发任务入口 | Multica | 2d |
| 6 | FTS5 全文搜索 | Claude Code Viewer | 3d |
| 7 | Tauri 插件扩展 | OpCode | 2d |
| 8 | WebSocket 作用域订阅 | Multica | 2d |
| | **合计** | | **24d** |

### P2 — M5+ 增强

| # | 采纳项 | 来源 | 天数 |
|---|--------|------|:--:|
| 1 | Plugin Marketplace（6 Slot） | CloudCLI + Dify | 8d |
| 2 | 可视化工作流编辑器 | Langflow + Flowise | 10d |
| 3 | YAML 声明式工作流 | ChatDev | 5d |
| 4 | Agent 市场/共享 | LibreChat + Kanna | 6d |
| 5 | Autopilot 定时任务 | Multica | 3d |

---

## 5. 明确不采纳的模式

| 模式 | 来源 | 理由 |
|------|------|------|
| Canvas-first | Langflow, Flowise | AgentHub IM-native, 画布辅助视图 |
| Docker 唯一沙箱 | OpenHands | 本地桌面过度设计, worktree 更轻量 |
| 中心化服务器权威 | Multica | AgentHub Hub-Edge 双层, Edge 本地自治 |
| Python Tool Provider | Dify | AgentHub 后端 Go, 重写成本高 |
| Issue/Board-first 入口 | Multica | AgentHub 入口 IM 群聊 |
| CRDT/OT 同步 | — | Agent 非字符级协同编辑 |
| 固定 YAML 拓扑 | ChatDev | 限制 Agent 动态调度 |

---

## 6. 架构差异化确认

以下决策在与所有参考项目对比后确认为正确方向：

1. **Hub-Edge 双层** — Multica 验证集中式局限, LibreChat 单体不适合离线
2. **IM-native 群聊入口** — 所有竞品中独有
3. **AgentAdapter 统一接口** — Kanna wrapper 模式维护成本高
4. **WebSocket 主协议 + NDJSON 适配器内** — 比 SSE 更适合双向
5. **SQLite + FTS5 Edge 本地** — 比 MongoDB 等中心 DB 更符合离线优先
6. **Turn 边界 = Checkpoint** — 比 OpCode Smart 策略更简洁

---

> **下一步**：按 P0 优先级逐项在 M3b 实现。专题分析见 `02-decide/` 各维度文档。
> **本分支**：`docs/reference-analysis` — 完整变更见本分支的 git log。
