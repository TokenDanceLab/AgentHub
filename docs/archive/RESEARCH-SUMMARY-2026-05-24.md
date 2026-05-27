# AgentHub 竞品研究总结 — 发送Leader

> 日期：2026-05-24 | 分支：`dev/delicious233` | 状态：已完成，已推送

---

## 做了什么

对 **21 个参考/竞品项目** 进行了深度源码级分析，产出 **68 份报告（35,000+ 行）**，全部按项目分类组织在 `docs/reference/projects/` 下。

每份 `source-adoption-map` 报告都包含：**参考源码具体 file:line → AgentHub 对应 file:line → 具体代码改动方案 → P0/P1/P2 优先级 + 工作量估算**。

### 覆盖项目矩阵

| 优先级 | 项目 | 文件 | 大小 | 核心参考价值 |
|:--:|------|:--:|------|------|
| **T0** | **LobeHub** | 4 | 68K | **最接近对标**：Agent编排+图标库+Hub设计 |
| **T0** | **LibreChat** | 4 | 108K | IM消息树、Fork机制、子代理调度 |
| **T0** | **Kanna** | 5 | 152K | 多Agent UI、流式渲染、AgentCoordinator |
| **T0** | **OpenCode** | 4 | 100K | 19Hook插件、LLM路由、185组件UI |
| **T0** | **Claude Code SDK** | 5 | 212K | 28Hook、23安全检查、上下文压缩 |
| **T0** | **Claude Code 源码** | 1 | 24K | NDJSON协议、安全管道、会话管理 |
| **T1** | Multica | 3 | 60K | 产品模型、任务生命周期、竞品格局 |
| **T1** | OpenHands | 4 | 104K | 三级沙箱、Agent协议、SDK四包 |
| **T1** | Codex CLI | 2 | 48K | 树形Multi-Agent、SQ/EQ队列 |
| **T1** | OpCode | 2 | 44K | Tauri桌面、内容寻址Checkpoint |
| **T1** | Goose | 2 | 52K | Agent运行时、MCP集成、权限管道 |
| **T2** | AI Coding Tools | 1 | 20K | aider/cline/continue/Roo-Code 21发现 |
| **T2** | Command Centers | 1 | 20K | 7个命令中心项目UI/UX模式 |
| **T2** | 其余7个 | 2-3各 | — | 可视化编排、工具提供、文件系统、模型路由 |

### 文档结构

```
docs/reference/
  README.md                                           ← 导航索引
  REPORT-TEMPLATE.md                                  ← 报告标准模板
  projects/          21个项目 × 1-5文件              ← 按项目分类
  cross-comparison/  10篇跨项目对比                   ← 含00-synthesis总报告 + 10-best-practices-playbook
  web-research/      3篇生态调研                      ← 技术选型/SDK/命令中心
  planning/          2篇规划                          ← P0最小系统/Claude SDK影响
```

---

## 关键发现（按 AgentHub 组件）

### 1. AgentAdapter 接口（最关键）

**当前状态**：`edge-server/internal/adapters/adapter.go` — 基础接口存在，但缺少：
- AgentHook 系统（Claude Code 28Hook + OpenCode 19Hook → 提炼为 6 核心 Hook）
- 工具安全管道（`DefaultPermissionHandler` **无条件全通过**所有工具调用——安全缺口）
- 模型声明式配置（当前 `model_config.go` 只有静态字符串映射）

**参考方案**：`cross-comparison/01-adapters.md` + `projects/claude-code-sdk/04-source-adoption-map.md`

### 2. Orchestrator 编排（M3b 最紧急）

**当前状态**：`edge-server/internal/adapters/orchestrator.go:26` — **明确忽略了 subAgents 参数**（`_ = subAgents`），仅通过 system prompt 让 Claude Code"假装编排"。

**缺失**：
- 无 Agent 实例注册表（无法 spawn 子 Agent）
- 无 Agent 间消息队列（Agent 无法互相通信）
- 无上下文预算管理（`context_budget.go` 只有一行桩代码）
- 无自动压缩引擎

**参考方案**：LobeHub `GeneralChatAgent` 决策循环 + Codex CLI `AgentTree/AgentPath` + LibreChat 消息树 Fork

### 3. UI 品质（最影响用户体验）

**当前状态**：功能骨架齐全，但视觉品质和 OpenCode/LobeHub 差距大。
- 字号 3 级 → 需要 7 级
- 文字色 2 档 → 需要 4 档
- 零动画 → 需要全局过渡 + 微交互
- 无空状态 → 需要四件套模板
- 无 token 用量展示

**方案**：`cross-comparison/08-ui-beautify-plan.md`（18 天计划）+ `projects/opencode/03-ui-adoption.md`

### 4. Hub Server（Johnny 方向正确）

Johnny 的 Hub Server（109 文件、15 migration）三层架构（handler→service→repository）与 LobeHub 的设计如出一辙。Schema 设计可对齐 LobeHub 的 `agents`/`agent_instances`/`sessions`/`messages` 表结构。

### 5. 技术栈确认

对比全部 21 个项目后确认 AgentHub 的技术选型正确：
- **Go Edge Server** ← 进程编排最优语言
- **Rust Tauri 壳** ← 系统层最轻方案
- **React 19 + shadcn/ui** ← LobeHub/OpenCode 验证
- **SQLite + FTS5** ← 离线优先正确选择
- **WebSocket + NDJSON** ← Agent 流式最佳协议

---

## P0 优先实施项（M3b，共 ~21 天）

| # | 项目 | 影响组件 | 参考项目 | 天数 |
|---|------|------|------|:--:|
| 1 | AgentHook 接口（6 核心 Hook） | edge/adapters | Claude Code + OpenCode | 5 |
| 2 | 安全管道（替换 DefaultPermissionHandler） | edge/security | Claude Code 23 检查 | 4 |
| 3 | 消息树渲染 | app/desktop | LibreChat buildTree | 4 |
| 4 | Orchestrator 真正 spawn Agent | edge/adapters | Codex CLI AgentTree | 5 |
| 5 | Context Budget 模型 | edge/context | LobeHub + LibreChat | 3 |

---

## 入口文档

| 想看什么 | 看这里 |
|------|------|
| **全貌** | `docs/reference/cross-comparison/00-synthesis.md` |
| **最佳实践索引** | `docs/reference/cross-comparison/10-best-practices-playbook.md` |
| **UI 美化计划** | `docs/reference/cross-comparison/08-ui-beautify-plan.md` |
| **某个项目的借鉴** | `docs/reference/projects/<name>/*-source-adoption-map.md` |
| **所有项目列表** | `docs/reference/README.md` |
