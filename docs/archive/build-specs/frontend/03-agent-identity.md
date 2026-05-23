# AgentHub Agent 身份与联系人系统设计

> 日期: 2026-05-21
> 依据: 跨仓库分析 LibreChat（Agent Marketplace）、OpenCode（8 个内置 agent）、ChatDev（基于角色的团队模型）、design-desktop-ux.md（sidebar+chat UI）、design-cli-wizard.md（agent 配置）

---

## 1. Agent 身份元数据 Schema

每个 AgentHub 中的 Agent 拥有一张统一的身份卡，驱动运行时行为和 UI 呈现。

### 1.1 核心身份字段

```yaml
agent:
  id: "claude-code-build"          # 唯一标识（kebab-case）
  display_name: "Claude Build"     # 显示名称
  avatar:                          # 视觉标识（3 级回退）
    type: "emoji"                   # emoji | initials | icon | image_url
    value: "\u{1F527}"             # 根据类型：emoji 字符、首字母字符串、图标名、URL
  color: "#D97706"                 # 强调色，用于头像圆环和 authority 色条
  description: "Full-capability coding agent for implementation tasks."
  classification: "executor"       # executor | reviewer | orchestrator | explorer | custom
  hidden: false                    # 隐藏 agent 不在选择器/市场中显示

  # Persona（结构化角色描述）
  persona:
    tagline: "Builds, edits, and ships code across the full stack."
    tone: "direct, technical, concise"
    domain: ["software-engineering", "devops", "data-engineering"]
    constraints:                     # 硬行为边界
      - "Always confirm before running destructive commands"

  # 能力标签（用于搜索/浏览/过滤）
  capabilities:
    - code-generation
    - file-editing
    - command-execution
    - git-operations
    - multi-step-planning

  # 系统提示词模板（go template 语法）
  system_prompt_template: |
    You are {{.DisplayName}}, an {{.Classification}} agent.
    Your role: {{.Persona.Tagline}}
    Tone: {{.Persona.Tone}}
    {{range .Persona.Constraints}}- {{.}}
    {{end}}
    Available tools: {{join .Tools ", "}}
    Current workspace: {{.Workspace}}

  # 任务亲和性提示（用于自动路由）
  affinity:
    strengths: ["complex refactoring", "greenfield implementation", "debugging"]
    weaknesses: ["frontend design review", "accessibility auditing"]

  # 模型与提供商绑定
  backend:
    adapter: "claude-code"          # 驱动该 agent 的 CLI adapter
    model: "claude-sonnet-4-5"      # 默认模型（可在运行时覆盖）
    provider: "anthropic"
    temperature: 0.7
    max_turns: 25

  # 工具集
  tools:
    mode: "allowlist"               # allowlist | denylist | inherit
    items:                          # adapter 工具注册表中的工具名
      - Read
      - Write
      - Edit
      - Bash
      - Glob
      - Grep
      - Task                         # 子 agent 派生能力

  # 权限
  permissions:
    mode: "default"                 # default | accept-edits | bypass | plan
    rules:                          # 覆盖特定权限
      - tool: "Bash"
        action: "ask"               # ask | allow | deny
      - tool: "Write"
        paths: ["*.md"]
        action: "allow"

  # Memory 挂载
  memories:
    - store: "project-index"        # 引用全局 memory store
      retrieve_stages: ["pre-gen", "gen"]
      top_k: 5
      read: true
      write: true

  # 可见性 / 共享（P1+）
  visibility: "workspace"           # private | workspace | public
  created_by: "user:ding"
  created_at: "2026-05-21T10:00:00Z"
  updated_at: "2026-05-21T12:00:00Z"
```

### 1.2 头像渲染规则

| 优先级 | `avatar.type` | 渲染来源 | 回退 |
|----------|---------------|---------------|----------|
| 1 | `emoji` | 单个 emoji 字符 | 色块 |
| 2 | `initials` | display_name 前 1-2 个字母 | 带首字母的色块 |
| 3 | `icon` | Lucide 图标名（映射到 React 组件） | 色块 |
| 4 | `image_url` | 远程 URL 或 data URI | 首字母回退 |

头像始终渲染为 36px 圆形（sidebar）、28px 圆形（内联 mention），外围 2px 圆环使用 agent 的 `color`。在线状态圆点（8px）锚定在头像圆形右下角。

### 1.3 能力标签分类

用于跨 agent 搜索和对比的标准化标签：

| 分类 | 标签 |
|----------|------|
| **核心** | `code-generation`, `code-review`, `debugging`, `refactoring` |
| **文件系统** | `file-reading`, `file-editing`, `file-creation`, `file-deletion` |
| **执行** | `command-execution`, `scripting`, `test-running`, `build-running` |
| **搜索** | `code-search`, `web-search`, `dependency-search`, `semantic-search` |
| **Git** | `git-operations`, `commit-generation`, `diff-analysis`, `branch-management` |
| **协调** | `task-delegation`, `multi-agent-planning`, `progress-tracking` |
| **专项** | `frontend-dev`, `backend-dev`, `devops`, `data-science`, `security-audit` |

---

## 2. Agent 角色分类体系

### 2.1 五种原型

受 OpenCode 内置 agent 模式和 ChatDev 基于角色的团队模型启发，AgentHub 将每个 agent 归入五种原型之一：

| 原型 | 符号 | 角色 | 类似物 |
|-----------|--------|------|-----------|
| **executor** | 扳手 | 构建、编辑、运行代码。主要执行者。 | OpenCode `build`，ChatDev Programmer（全部 5 个变体） |
| **reviewer** | 搜索-检查 | 检查、审计、测试。质量关卡。 | OpenCode（无内置），ChatDev Code Reviewer + Software Test Engineer |
| **orchestrator** | 网络 | 规划、委派、协调多 agent 工作。 | OpenCode `general`（子 agent），ChatDev CEO + CPO |
| **explorer** | 指南针 | 搜索、发现、报告。默认只读。 | OpenCode `explore` + `scout`，ChatDev（无内置） |
| **custom** | 用户 | 用户自定义角色，自由配置。 | 用户创建的 agent、插件提供的 agent |

### 2.2 按分类的默认值

| 属性 | executor | reviewer | orchestrator | explorer | custom |
|----------|----------|----------|--------------|----------|--------|
| **默认权限** | allow-edit, ask-bash | read-only, allow-run-tests | allow-all, allow-subagent-spawn | read-only, deny-edit | 用户配置 |
| **默认工具集** | Read/Write/Edit/Bash/Task/Grep/Glob | Read/Bash(test)/Grep/Glob/Task(review) | Read/Write/Edit/Bash/Task/Grep/Glob | Read/Grep/Glob/WebFetch/WebSearch | 用户配置 |
| **最大 turns** | 25 | 15 | 30 | 10 | 用户配置 |
| **Temperature** | 0.7 | 0.3 | 0.8 | 0.5 | 用户配置 |
| **系统提示词语气** | 直接、行动导向 | 批判、彻底 | 战略、协调 | 好奇、详尽 | 用户配置 |
| **子 agent 派生** | 允许（按需） | 拒绝 | 允许（主要角色） | 拒绝 | 用户配置 |
| **头像默认 emoji** | 扳手 | 显微镜 | 站点地图 | 放大镜 | 机器人 |

### 2.3 分类状态机

```
                    ┌──────────┐
                    │  custom   │  （用户定义，始终可变）
                    └────┬─────┘
                         │ 用户提升分类
    ┌────────────────────┼────────────────────┐
    ▼                    ▼                    ▼
┌──────────┐      ┌──────────┐        ┌──────────┐
│ executor │      │ reviewer │        │ explorer │
└────┬─────┘      └────┬─────┘        └──────────┘
     │                  │
     │   被编排         │  报告给
     │                  │
     ▼                  ▼
┌─────────────────────────────────┐
│        orchestrator              │
│  （协调 executor +               │
│   reviewer + explorer）           │
└─────────────────────────────────┘
```

Orchestrator 可以派生 executor/reviewer/explorer 子 agent。Reviewer 向 orchestrator 或直接向用户报告发现。Explorer 向任何原型提供搜索结果。

---

## 3. 默认 Persona 模板

### 3.1 模板架构

Persona 定义为参数化模板。模板通过绑定 backend adapter + model 进行实例化，产生具体的 Agent 身份卡。模板存储在 `~/.agenthub/personas/`（YAML），可通过 AgentHub 市场共享（P1+）。

```yaml
# ~/.agenthub/personas/senior-backend-dev.yaml
template:
  id: "senior-backend-dev"
  display_name: "Senior Backend Developer"
  classification: "executor"
  avatar: { type: "emoji", value: "\u{1F40D}" }  # 蛇
  color: "#059669"
  description: "Experienced backend engineer specializing in API design, database optimization, and system architecture."
  persona:
    tagline: "Designs robust APIs, optimizes queries, and builds scalable backend systems."
    tone: "pragmatic, performance-conscious, pattern-aware"
    domain: ["backend", "api-design", "databases", "system-architecture"]
    constraints:
      - "Always add error handling and input validation"
      - "Prefer standard library over third-party deps unless justified"
      - "Include tests for new functionality"
  capabilities:
    - code-generation, file-editing, command-execution
    - code-search, git-operations, multi-step-planning
  tools:
    mode: "allowlist"
    items: [Read, Write, Edit, Bash, Grep, Glob, Task]
  permissions:
    mode: "default"
  affinity:
    strengths: ["API development", "database schema design", "performance profiling"]
    weaknesses: ["CSS/frontend styling", "mobile development"]
  system_prompt_template: |
    You are {{.DisplayName}}, a {{.Classification}} agent.
    {{.Persona.Tagline}}
    Tone: {{.Persona.Tone}}
    {{range .Persona.Constraints}}
    - {{.}}
    {{end}}
    Before writing code, understand the existing patterns in the codebase.
    Follow the project's conventions. When in doubt, read existing files first.
```

### 3.2 内置模板目录

AgentHub 内置 9 个默认 persona 模板，覆盖 OpenCode 的 5 个活跃模式以及 ChatDev 成熟的团队角色：

| 模板 ID | 显示名称 | 分类 | 灵感来源 |
|-------------|--------------|----------------|--------------------|
| `build` | Build Agent | executor | OpenCode `build` -- 全能力编码器 |
| `plan` | Planning Agent | orchestrator | OpenCode `plan` -- 只读策略师 |
| `review` | Code Reviewer | reviewer | ChatDev Code Reviewer -- 质量关卡 |
| `test` | Test Engineer | reviewer | ChatDev Software Test Engineer |
| `explore` | Code Explorer | explorer | OpenCode `explore` -- 快速只读搜索 |
| `scout` | Dependency Scout | explorer | OpenCode `scout` -- 仓库/文档搜索 |
| `ceo` | Product Manager | orchestrator | ChatDev CEO -- 需求分析 + 委派 |
| `programmer` | Full-Stack Programmer | executor | ChatDev Programmer 组合 -- 编码 + 完成 |
| `general` | General Assistant | custom | OpenCode `general` -- 复杂多步骤任务 |

### 3.3 模板实例化示例

```bash
# 从模板创建 agent
agenthub config agent create --from-template senior-backend-dev \
  --adapter claude-code \
  --model claude-sonnet-4-5 \
  --name "my-backend-agent"

# 列出可用模板
agenthub config agent templates
```

实例化将模板默认值与用户覆盖合并，在 `config.yaml` 中产生具体 agent 条目：

```yaml
agents:
  my-backend-agent:
    template: "senior-backend-dev"
    adapter: "claude-code"
    model: "claude-sonnet-4-5"
    # 所有模板字段被继承；覆盖项浅合并
    permissions:
      mode: "accept-edits"  # 覆盖：比模板默认值更宽松
```

### 3.4 隐藏实用 Agent

遵循 OpenCode 的模式，AgentHub 为系统用途保留三个隐藏 agent 类型（永不显示在联系人列表或市场中）：

| Agent | 分类 | 用途 |
|-------|---------------|---------|
| `_compaction` | hidden | 会话上下文摘要。无工具。 |
| `_title` | hidden | 自动生成会话标题。temperature=0.5。 |
| `_summary` | hidden | 生成 sidebar 预览的会话摘要。 |

这些由 Hub/Edge 自动实例化，用户不可配置。

---

## 4. Agent 联系人 UI 设计

### 4.1 Sidebar 联系人列表布局

左侧 sidebar（默认 280px，来自 `design-desktop-ux.md` 第 1 节）在 ProjectTree 下方增加 "Agents" 区域。以联系人列表形式呈现 agent——即 agent 交互的 IM 隐喻。

```
┌─────────────────────────────────┐
│ 🔍 Search sessions...           │
│ [All] [Hub] [Edge:us1] [+ New] │
├─────────────────────────────────┤
│ 📂 project-search               │  ← ProjectTree（现有）
│   ├─ auth-refactor              │
│   └─ deploy-k8s                 │
├─────────────────────────────────┤
│ AGENTS                     [⋯]  │  ← Agent 联系人列表标题
│ ┌─────────────────────────────┐ │
│ │ 🐍 Senior Backend Dev  🟢  │ │  ← Emoji 头像 + 名称 + 在线圆点
│ │ backend, api-design         │ │  ← 能力标签（1-2 个，截断）
│ │ Active · 2m ago             │ │  ← 状态 + 相对时间
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 🔨 Build Agent         🟡   │ │  ← 忙碌（运行中）
│ │ code-generation, refactor   │ │
│ │ Running auth-refactor       │ │  ← 当前任务预览
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 🔍 Code Explorer        ⚫   │ │  ← 离线（无活跃会话）
│ │ search, codebase-explore    │ │
│ │ Last active · 1h ago        │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 🧪 Test Engineer        ⚫   │ │
│ │ testing, debugging          │ │
│ │ Idle                        │ │
│ └─────────────────────────────┘ │
│                                 │
│ [+ Add Agent] [Browse Market]  │  ← 底部操作
└─────────────────────────────────┘
```

### 4.2 Agent 卡片组件状态

联系人列表中的每个 `AgentCard` 渲染五种状态之一：

| 状态 | 圆点颜色 | 悬停操作 | 点击操作 |
|-------|-----------|-------------|--------------|
| **online**（空闲） | 绿色 | 显示展开卡片 | 开始新会话 |
| **busy**（运行中） | 黄色/脉冲 | 显示当前任务预览 | 跳转到活跃会话 |
| **offline** | 灰色 | 显示最后活跃时间 | 打开 agent 配置 |
| **error** | 红色 | 显示错误原因 | 打开 agent 诊断 |
| **needs_setup** | 橙色 | 显示设置提示 | 打开设置向导 |

### 4.3 展开联系人卡片（悬停卡片）

悬停联系人卡片显示 300px 弹出框，包含完整 agent 资料：

```
┌──────────────────────────────────────┐
│  🐍  Senior Backend Developer   🟢   │
│  executor · Claude Sonnet 4.5        │
│                                      │
│  "Designs robust APIs, optimizes     │
│   queries, and builds scalable       │
│   backend systems."                  │
│                                      │
│  Capabilities                        │
│  [code-gen] [file-edit] [cmd-exec]   │
│  [code-search] [git-ops] [planning]  │
│                                      │
│  Affinity                            │
│  ✓ API development                   │
│  ✓ Database schema design            │
│  ✗ CSS/frontend styling              │
│                                      │
│  Active sessions: 2                  │
│  Total conversations: 47            │
│  Avg. tokens/run: 3.2k              │
│                                      │
│  [Start Chat]    [Edit Agent]        │
│  [Duplicate]     [View Sessions]     │
└──────────────────────────────────────┘
```

### 4.4 聊天内 Agent 表示

当 agent 参与会话时，它显示在消息流中并附带身份卡：

**MessageHeader**（来自 `design-desktop-ux.md` 的现有组件，增强后）：
```
┌─────────────────────────────────────────────────────────────┐
│ 🐍 Senior Backend Developer · [Edge:us1] · 2 min ago       │
│ executor · Claude Sonnet 4.5 · Run #3                       │
├─────────────────────────────────────────────────────────────┤
│ I've analyzed the auth module and found three issues:       │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

头像、分类徽章和能力标签均从 agent 身份卡内联渲染。

### 4.5 Agent 选择器（输入区域）

输入区域包含 agent mention 选择器。输入 `@` 打开模糊搜索下拉框：

```
┌──────────────────────────────────────────┐
│ @senior                                     │
│ ┌────────────────────────────────────────┐ │
│ │ 🐍 Senior Backend Developer            │ │
│ │    executor · Claude Sonnet 4.5 · 🟢   │ │
│ │    backend, api-design, databases      │ │
│ ├────────────────────────────────────────┤ │
│ │ 🐍 Junior Backend Dev (custom)         │ │
│ │    executor · Claude Sonnet 4.5 · 🟢   │ │
│ │    backend, api-design                 │ │
│ ├────────────────────────────────────────┤ │
│ │ 🔍 Code Explorer                       │ │
│ │    explorer · Claude Haiku 4.5 · ⚫     │ │
│ │    search, codebase-explore            │ │
│ └────────────────────────────────────────┘ │
│                                             │
│ Recent agents: 🐍 Senior BE  🔨 Build      │
└──────────────────────────────────────────────┘
```

多个 `@mentions` 启动群聊。第一个 `@mention` 设置主 agent（直接接收提示词）。后续 `@mentions` 添加观察者或次要 agent（接收上下文但不执行操作，除非明确指定）。

### 4.6 Agent 状态 Store

```ts
// src/stores/agentContactStore.ts
interface AgentContactState {
  agents: Map<string, AgentContact>
  agentOrder: string[]
  filters: {
    classification: string[]     // ['executor', 'reviewer', ...]
    capability: string[]         // ['code-generation', ...]
    status: ('online' | 'busy' | 'offline' | 'error' | 'needs_setup')[]
  }
}

interface AgentContact {
  // 核心身份（来自 agent 配置）
  id: string
  displayName: string
  avatar: Avatar
  color: string
  classification: Classification
  capabilities: string[]

  // 运行时状态（通过 WS 事件更新）
  status: AgentStatus
  activeRunId: string | null
  activeSessionTitle: string | null
  lastActiveAt: string

  // 统计（从 run 历史计算）
  totalConversations: number
  avgTokensPerRun: number
  recentActivity: ActivityEntry[]   // 最近 5 次 run
}

type AgentStatus = 'online' | 'busy' | 'offline' | 'error' | 'needs_setup'

interface ActivityEntry {
  runId: string
  action: string
  threadTitle: string
  timestamp: string
  tokensUsed: number
}
```

**WebSocket 事件 -> AgentContactStore 映射**：

| WS 事件 | Store 操作 | 效果 |
|----------|-------------|--------|
| `run.started` | `setAgentStatus(id, 'busy')` | 黄色圆点 + 任务预览 |
| `run.completed` | `setAgentStatus(id, 'online')` | 绿色圆点 + 更新 lastActiveAt + 追加 ActivityEntry |
| `run.failed` | `setAgentStatus(id, 'error')` | 红色圆点 + 错误原因 |
| `agent.registered` | `addAgent(contact)` | 新卡片出现 |
| `agent.unregistered` | `removeAgent(id)` | 卡片移除 |
| `agent.config_updated` | `updateAgent(id, patch)` | 刷新卡片元数据 |

### 4.7 Agent 快捷操作（上下文菜单）

右键点击 AgentCard 打开上下文菜单：

| 操作 | 行为 |
|--------|----------|
| **Start Chat** | 以该 agent 为主要 agent 创建新会话 |
| **Add to Current Chat** | 在活跃会话中 @mention 该 agent |
| **View Active Sessions** | 过滤 sidebar 仅显示该 agent 的会话 |
| **Duplicate Agent** | 以新名称克隆配置（如 "Senior BE - Strict"） |
| **Edit Agent** | 打开 agent 配置面板（SidePanel） |
| **Set Offline** | 标记 agent 为不可用（停止自动路由） |
| **Remove Agent** | 删除 agent 配置并归档会话 |

### 4.8 与现有 Sidebar 集成

Agent 联系人列表集成到 `design-desktop-ux.md` 中现有的 `LeftSidebar` 组件树：

```
LeftSidebar
├── SidebarToolbar
│   ├── NewThreadButton
│   ├── ToggleArchiveButton
│   └── SettingsGear
├── SearchBar
├── ProjectTree              （现有）
│   └── ThreadCard[]
├── AgentContactList         （新增）
│   ├── AgentContactHeader   （"AGENTS" 标签 + 过滤下拉 + 折叠箭头）
│   └── AgentCard[]          （虚拟列表，36px 行）
│       ├── Avatar（36px 圆形 + 2px 颜色圆环 + 状态圆点）
│       ├── AgentName + ClassificationBadge
│       ├── CapabilityTags（最多 2 个，"+N" 截断）
│       └── ActivityLine（状态文本或任务预览）
├── SidebarPluginSlot
└── SidebarFooter
```

AgentContactList 可独立折叠/展开于 ProjectTree。默认状态：无活跃 agent 时折叠，任何 agent 忙碌时自动展开。

---

## 5. Persona 模板共享（P1+ 市场）

### 5.1 模板包格式

```
my-agent-team/
├── manifest.yaml           # 模板元数据 + 版本
├── personas/
│   ├── senior-backend.yaml
│   ├── frontend-reviewer.yaml
│   └── devops-engineer.yaml
└── README.md               # 使用指南
```

### 5.2 市场集成

- 模板发布到 AgentHub Marketplace（P1+）
- 通过搜索 + 能力标签 + 分类过滤器发现
- 一键安装：`agenthub config agent install <template-id>`
- 版本管理：模板遵循 semver；已安装 agent 可选择自动更新

---

## 6. 设计决策摘要

| 决策 | 选择 | 理由 |
|----------|--------|-----------|
| 身份模型 | 单 YAML 卡片 + 模板实例化 | ChatDev 的 FIELD_SPECS 驱动表单 + OpenCode 的 Agent Info Schema 的结合 |
| 分类 | 5 种原型（executor/reviewer/orchestrator/explorer/custom） | 覆盖 OpenCode 5 个活跃模式 + ChatDev 团队角色，不过度碎片化 |
| 头像系统 | 4 级回退（emoji > 首字母 > 图标 > 图片） | 无外部依赖；完全离线可用 |
| 能力标签 | 7 个类别的标准化分类 | 支持跨 agent 搜索和自动路由 |
| Persona 模板 | 参数化 YAML + go template 语法 | ChatDev 的 yaml_instance 模式 + AgentHub 的 adapter 绑定模型 |
| 联系人 UI | Sidebar 区域，5 种状态圆点 | IM 隐喻；与 design-desktop-ux.md sidebar 组件树一致 |
| Agent mention | 输入区域 @ 模糊搜索下拉框 | 熟悉的 IM UX 模式；支持群聊启动 |
| 隐藏 agent | `_compaction`、`_title`、`_summary` 保留 | 匹配 OpenCode 的 compaction/title/summary 隐藏 agent |
| 模板共享 | Manifest + personas/ 目录 + 市场 | 可在不改变 P0 sidebar/联系人模型的情况下为 P1+ 扩展 |

---

## 7. 参考资料

- `librechat.md` -- Agent Marketplace grid + CategoryTabs + AgentDetail 面板
- `opencode.md` -- 8 个内置 agent、Agent Info Schema、`generateObject()` 动态生成
- `chatdev.md` -- ChatDev 基于角色的团队模型、FIELD_SPECS + child_routes 配置系统、yaml_instance 模板
- `design-desktop-ux.md` -- LeftSidebar 组件树、ThreadCard 含 AgentIcon、MessageHeader 含 ActorAvatar
- `design-cli-wizard.md` -- `agenthub config agent` CRUD 命令、agent 检测流程
- `cross-analysis-im-ux.md` -- Sidebar 会话列表设计、Authority 徽章模式、AgentHub 定位

---

*设计完成。2026-05-21。*
