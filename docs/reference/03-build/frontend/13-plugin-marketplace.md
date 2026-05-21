# AgentHub 插件市场 -- 设计

> 生成: 2026-05-21
> 来源: cloudcli.md（Plugin manifest + RPC proxy + 原子安装）、
>   opencode.md（19 Hooks + 双向模式）、
>   librechat.md（Agent Marketplace + MCP manager）、
>   langflow.md（MCP 三层升级链 + Component registration）、
>   design-adapter-sdk.md（3 种注册模式 + 生命周期）

---

## 1. 设计理念

AgentHub 的插件系统借鉴了四个参考实现，每个贡献一个不同的层：

| 参考 | 贡献 | 层 |
|-----------|------------|-------|
| **CloudCLI** | Manifest schema、原子安装、RPC proxy、进程管理器 | 打包与分发 |
| **OpenCode** | 双向 hook 模式 `(input, output) => Promise<void>`、19 个生命周期 hooks、权限合并 | 运行时扩展 |
| **LibreChat** | Agent Marketplace UI（grid + 虚拟化 + 分类标签页）、MCP manager 单例 | 发现与发现 UI |
| **Langflow** | `tool_mode=True` → Agent tool → MCP tool 升级链、Component registration、每项目 MCP | 能力导出 |

核心原则: **插件以本地代码起步，毕业为 Agent tool，可选地作为 MCP tool 对外暴露 -- 无需代码变更**。这是 Langflow 三层链应用于 AgentHub 的 Runner 模型。

---

## 2. 插件市场生命周期

### 2.1 发现

插件从三个来源发现，镜像 design-adapter-sdk.md 第 1.3 节的 adapter 注册三模式：

```
来源 1: 内置注册表
  packages/plugin/registry/ -- Go init() 自注册
  Runner 启动时加载，始终可用

来源 2: 市场索引
  ~/.agenthub/plugins/ -- manifest.yaml 扫描（CloudCLI 模式）
  discoverPlugins() 跳过 .tmp-* 目录（原子安装保护）

来源 3: 远程注册表
  GET /api/v1/plugins/search?q=&category=&author=&sort=
  远程插件索引，带版本元数据
```

**市场 UI**（来自 LibreChat 第 1.6 节 + Langflow 第 1.5 节）：

- **Grid 视图**，虚拟化卡片（`react-virtualized` 或 `@tanstack/virtual`）
- **分类标签页**过滤（agent、tool、theme、skill、mcp-bridge）
- **Fuse.js 模糊搜索**跨名称、描述、作者、标签（Langflow sidebar 模式）
- **插件详情**页：描述、版本历史、权限、安装数、作者信息
- **共享/权限 UI**：LibreChat 的 People Picker + Access Roles 模式

### 2.2 安装流程（原子化）

直接适配 CloudCLI 的 `installPluginFromGit()` 原子模式（cloudcli.md 第 2.6 节）：

```
1. 解析插件源（git URL、注册表 ID 或本地路径）
2. 根据现有注册表验证名称 + 版本（重复检查）
3. 克隆/下载到 .tmp-<name>-<hash>/（被 scanPlugins 跳过）
4. 验证 manifest.yaml:
   - name: ^[a-zA-Z0-9_-]+$
   - displayName: 非空
   - entry: 无路径遍历（.. 检查），无绝对路径
   - permissions: 必须是字符串数组
5. 运行 npm install --ignore-scripts（防止 postinstall 攻击，CloudCLI L341）
6. 如存在 build script，运行构建（60s 超时，CloudCLI L96-143）
7. fs.renameSync .tmp-* -> <plugin-name>/（原子化 -- 扫描器永不看到半安装状态）
8. 在插件注册表中注册
9. 如 manifest 有 server entry，启动 server sidecar
```

### 2.3 更新流程

```
1. 从 manifest.yaml 检查当前版本
2. 与目标版本对比（注册表或 git tag）
3. 备份当前插件目录 -> .bak-<name>-<version>/
4. 在全新 .tmp-* 目录中重复安装步骤 3-9
5. 成功时: 将 .tmp-* 替换为插件目录，删除备份
6. 失败时: 从 .bak-*/ 恢复，报告错误
7. 重启 server sidecar（SIGTERM → SIGKILL 两阶段，CloudCLI L111-136）
```

### 2.4 卸载流程

```
1. SIGTERM server sidecar（5s 宽限期）→ SIGKILL
2. 移除插件目录
3. 从插件注册表中移除
4. 清理插件范围数据（配置、密钥、缓存）
```

### 2.5 版本固定与依赖解析

- **Semver 范围**在 manifest 中: `"dependencies": { "agenthub": "^1.2.0" }`
- **插件到插件依赖**: `"requires": { "mcp-bridge": ">=0.3.0" }`
- **冲突检测**: 两个插件以相同优先级请求同一 slot → 用户解决
- **回滚**: 在 `.bak-*` 中保留最近 N 个版本以供快速还原

---

## 3. 插件位类型

CloudCLI 当前仅有 `"tab"`（cloudcli.md L140）。AgentHub 扩展到**五种位类型**：

| 位 | 显示位置 | 插件获得的内容 | 示例用例 |
|------|-----------------|-----------------|-----------------|
| **`tab`** | 主内容区域作为新标签页（CloudCLI 模式） | 完整 React 组件，`mount(container, api)` / `unmount(container)` | 看板、图表编辑器、工作流设计器 |
| **`panel`** | Sidebar 底部区域，可折叠面板 | React 组件，高度受限（最大 400px） | 迷你文件浏览器、快捷操作、状态监控 |
| **`toolbar`** | 顶部工具栏图标 + 下拉/弹出框 | 弹出框容器中的 React 组件 | 快速提示词模板、剪贴板管理器 |
| **`tool`** | 注册为 Agent 工具（无 UI，纯函数） | Tool 定义: `{ name, description, parameters, execute }` | API 调用、数据库查询、文件转换 |
| **`skill`** | 注册为 Agent 技能（注入系统提示词） | Skill 定义: `{ name, description, instructions }` | 代码风格指南、领域知识、工作流模板 |
| **`theme`** | 全局主题覆盖 | CSS 变量映射 + 可选暗/亮变体 | 自定义配色方案、字体集 |

**位优先级与冲突解决**:
- 多个插件可注册同一位
- `tab` / `panel` / `toolbar`: 按 `manifest.priority` 排序（默认 0），用户可重新排序
- `tool` / `skill`: 名称唯一；冲突 = 最后安装者获胜并警告
- `theme`: 同一时间仅一个活跃主题；用户在设置中选择

### 3.1 UI 位 API（tab / panel / toolbar）

每个 UI 插件接收一个标准 `PluginAPI` 对象（来自 CloudCLI L95-115）：

```typescript
interface PluginAPI {
  // 环境上下文
  context: {
    theme: "dark" | "light"
    project: { name: string; path: string }
    session: { id: string; title: string }
  }
  onContextChange(cb: (ctx: PluginContext) => void): () => void  // 取消订阅

  // 到插件 server sidecar 的 RPC
  rpc(method: string, path: string, body?: unknown): Promise<unknown>

  // Agent 交互（仅 tool/skill 位）
  agent: {
    sendPrompt(text: string): Promise<void>
    getMessages(): Message[]
    onToolCall(cb: (call: ToolCall) => ToolResult): () => void
  }

  // UI 工具
  ui: {
    showNotification(opts: NotificationOpts): void
    openFile(path: string): void
  }
}
```

### 3.2 非 UI 位类型（tool / skill）

**Tool 位** -- 注册为可调用的 Agent 工具：

```yaml
# manifest.yaml（tool 位）
slot: tool
tool:
  name: "git_commit_summary"
  description: "Generate a summary of recent git commits"
  parameters:
    type: object
    properties:
      since:
        type: string
        description: "Git rev range, e.g. HEAD~5..HEAD"
    required: ["since"]
  execute: "tool-handler.js"  # 导出 async execute(params, context)
```

**Skill 位** -- 注入 Agent 系统提示词：

```yaml
# manifest.yaml（skill 位）
slot: skill
skill:
  name: "python_style_guide"
  description: "Enforce project Python style conventions"
  instructions: |
    When writing Python code:
    - Use type hints on all function signatures
    - Prefer dataclasses over plain dicts
    - Max line length: 100 characters
  always_apply: false   # true = 始终在提示词中，false = 按需
```

### 3.3 位加载策略

| 位 | 加载时机 | 失败行为 |
|------|------------|-----------------|
| `tab` | 手动激活（用户点击） | 标签容器中的错误边界 |
| `panel` | Sidebar 渲染时 | 折叠并带错误指示器 |
| `toolbar` | 工具栏渲染时 | 隐藏并记录日志 |
| `tool` | Agent 启动时 | 跳过，agent init 中警告 |
| `skill` | Agent 启动时 | 跳过，系统提示词构建中警告 |
| `theme` | 应用加载时 | 回退到默认主题 |

---

## 4. 插件权限模型

### 4.1 权限类别

受 CloudCLI 权限数组（cloudcli.md L131）和 OpenCode 层次化权限合并（opencode.md 第 2.1 节 L152-158）启发：

| 类别 | 权限 | 授予内容 |
|----------|-----------|---------------|
| **`fs`** | `fs.read` | 读取项目范围内的文件 |
| | `fs.write` | 写入项目范围内的文件 |
| | `fs.delete` | 删除项目范围内的文件 |
| | `fs.exec` | 执行文件 / 运行脚本 |
| **`network`** | `network.http` | 出站 HTTP 请求 |
| | `network.websocket` | WebSocket 连接 |
| | `network.listen` | 打开本地服务器端口 |
| **`agent`** | `agent.prompt` | 向活跃 agent 发送提示词 |
| | `agent.messages.read` | 读取 agent 会话历史 |
| | `agent.tool.intercept` | 拦截/挂钩工具调用 |
| | `agent.tool.define` | 在运行时注册新工具 |
| | `agent.subagent.spawn` | 派生子 agent |
| **`system`** | `system.env.read` | 读取环境变量 |
| | `system.process.spawn` | 派生子进程（sidecar） |
| | `system.clipboard` | 读/写系统剪贴板 |
| | `system.notification` | 显示操作系统通知 |
| **`ui`** | `ui.inject` | 注入 UI 组件 |
| | `ui.theme` | 覆盖主题 |
| | `ui.shortcut` | 注册键盘快捷键 |
| **`user`** | `user.identity` | 访问用户 ID/email |
| | `user.secrets` | 访问各插件的密钥 |

### 4.2 权限声明

```yaml
# manifest.yaml
permissions:
  - fs.read
  - fs.write
  - network.http
  - agent.prompt
  - ui.inject
```

### 4.3 权限关口

三层权限关口，适配自 OpenCode 的合并模型：

```
层 1: Plugin manifest  → 声明的权限（插件请求的内容）
层 2: User config      → 用户批准的权限（用户允许的内容）
层 3: Agent policy     → 组织策略（管理员强制执行的允许/拒绝列表）

有效权限 = 层1 ∩ 层2 ∩ 层3  （交集，非并集）
```

**运行时强制执行**:
- `fs.*`: 验证路径在项目范围内（`path.resolve + startsWith` 检查，CloudCLI L271-273）
- `network.*`: 出站请求的 SSRF 安全代理（LibreChat `createSSRFSafeUndiciConnect`，librechat.md 第 3.5 节）
- `agent.*`: 在每次工具调用 / 提示词注入点检查
- `user.secrets`: 密钥注入为 `X-Plugin-Secret-*` 请求头，永不暴露在 API 响应中（CloudCLI L244-246）

### 4.4 安装时权限提示

当用户安装插件时，看到：

```
Plugin: "Database Explorer" v1.2.0 by @author
Required permissions:
  [x] fs.read       -- Read project files
  [x] network.http  -- Connect to database server
  [ ] fs.write      -- (not requested)
  [ ] agent.prompt  -- (not requested)
  [!] system.process -- SPAWN CHILD PROCESSES -- requires extra approval

[Allow] [Allow with restrictions...] [Deny]
```

**危险权限类别**（`system.process.spawn`、`fs.exec`、`network.listen`）需要用户显式确认 -- 不能通过 `--yes` 或配置默认值授予。

### 4.5 运行时权限审计

- 所有权限敏感的操作记录为 `[plugin:<name>]` 前缀
- 用户可查看权限使用情况: Settings > Plugins > <name> > Permissions Audit
- 过多的拒绝事件触发警告: "Plugin X tried to access fs.write 47 times and was denied"

---

## 5. AgentHub 插件系统架构

### 5.1 总体架构

```
┌──────────────────────────────────────────────────┐
│                   AgentHub Hub                     │
│                                                    │
│  ┌──────────────────┐   ┌──────────────────────┐  │
│  │ Plugin Registry  │   │ Plugin Manager        │  │
│  │ （init() +        │   │ （生命周期: install、  │  │
│  │   manifest scan） │   │  start、stop、update）│  │
│  └──────┬───────────┘   └──────────┬───────────┘  │
│         │                          │               │
│         ▼                          ▼               │
│  ┌──────────────────────────────────────────────┐  │
│  │              Plugin Runtime                    │  │
│  │                                                │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────────────┐  │
│  │  │ UI Slot │ │Tool Slot│ │ Skill Slot       │  │
│  │  │ Runtime │ │ Runtime │ │ Runtime           │  │
│  │  │（React   │ │（Tool    │ │（提示词注入）    │  │
│  │  │ mount）  │ │Registry）│ │                   │  │
│  │  └────┬────┘ └────┬────┘ └────────┬────────┘  │
│  │       │           │               │            │
│  │       ▼           ▼               ▼            │
│  │  ┌──────────────────────────────────────────┐  │
│  │  │          Permission Gate                   │  │
│  │  │  （manifest ∩ user ∩ policy 强制执行）    │  │
│  │  └────────────────────┬─────────────────────┘  │
│  │                       │                        │
│  └───────────────────────┼────────────────────────┘
│                          │
│                          ▼
│  ┌──────────────────────────────────────────────┐
│  │          Plugin Server Sidecar                 │
│  │  （Node.js/Python/Rust -- ready 协议）         │
│  │  RPC: POST /rpc/<path>                         │
│  │  Secrets: X-Plugin-Secret-* headers            │
│  └──────────────────────────────────────────────┘
│                                                    │
│                          │
│                          ▼  （可选 MCP 导出）
│  ┌──────────────────────────────────────────────┐
│  │       MCP Endpoint（tool_mode=true）           │
│  │  tools/list → plugin tools                     │
│  │  tools/call → plugin tool invocation           │
│  └──────────────────────────────────────────────┘
└──────────────────────────────────────────────────┘
```

### 5.2 插件 Manifest Schema（最终版）

综合自 CloudCLI 的 manifest（cloudcli.md L116-131）+ design-adapter-sdk.md L337-361 + 位扩展：

```yaml
# manifest.yaml -- AgentHub Plugin Manifest
name: my-plugin                   # 必需: ^[a-zA-Z0-9_-]+$
displayName: My Plugin            # 必需: UI 标签
version: 1.2.0                    # 必需: semver
description: "Does something useful"
author: "developer-name"
icon: Database                    # Lucide 图标名
type: plugin                      # "plugin"（用于市场） | "adapter"（用于 agent adapter）
slot: tab                         # tab | panel | toolbar | tool | skill | theme

# UI 位入口（tab/panel/toolbar 位必需）
entry: dist/plugin.js             # 相对路径，不允许 ..

# Server sidecar（可选）
server: server.js                 # 相对路径，作为子进程启动

# Tool/Skill 位字段（tool/skill 位必需）
tool:                             # 仅当 slot: tool
  name: my_tool
  description: "Tool description"
  parameters: {...}               # JSON Schema
  execute: handler.js

skill:                            # 仅当 slot: skill
  name: my_skill
  description: "Skill description"
  instructions: "Instructions injected into system prompt"
  always_apply: false

# Theme 位字段（slot: theme 必需）
theme:                            # 仅当 slot: theme
  variables:
    --primary: "#3B82F6"
    --background: "#0F172A"

# 权限（必需）
permissions:
  - fs.read
  - network.http

# 依赖（可选）
dependencies:
  agenthub: "^1.0.0"
requires:                         # 插件依赖
  mcp-bridge: ">=0.3.0"

# 元数据（可选）
tags: [database, productivity]
homepage: https://github.com/author/my-plugin
priority: 0                       # 位顺序，越高越靠前
```

### 5.3 插件 SDK

每种插件类型获得一个专注的 SDK：

**UI 插件**（`@agenthub/plugin-sdk/ui`）：

```typescript
import { createPlugin, PluginAPI } from "@agenthub/plugin-sdk/ui"

export default createPlugin({
  mount(container: HTMLElement, api: PluginAPI) {
    // 将 React/Preact/Svelte/Vanilla 渲染到 container
    // api.rpc()、api.context、api.onContextChange() 可用
  },
  unmount(container: HTMLElement) {
    // 清理
  }
})
```

**Tool 插件**（`@agenthub/plugin-sdk/tool`）：

```typescript
import { defineTool } from "@agenthub/plugin-sdk/tool"

export default defineTool({
  name: "git_commit_summary",
  description: "Summarize recent git commits",
  parameters: { ... },
  async execute(params, context) {
    // context.project、context.session、context.secrets
    return { summary: "..." }
  }
})
```

**Skill 插件**（`@agenthub/plugin-sdk/skill`）：

```typescript
import { defineSkill } from "@agenthub/plugin-sdk/skill"

export default defineSkill({
  name: "python_style_guide",
  instructions: "When writing Python: use type hints...",
  // 可选：基于上下文的动态指令
  async getInstructions(context) {
    if (context.project.language === "python") {
      return "Full Python style guide ..."
    }
    return null  // skill 不适用
  }
})
```

### 5.4 插件 Hook 系统

适配自 OpenCode 的 19-hook 双向模型（opencode.md 第 1.2 节）：

Hooks 使用 `(input, output) => void` 双向模式。所有 hooks 均为可选。

| Hook | 何时触发 | Input | Output（可变） |
|------|------|-------|-----------------|
| `agent.before_start` | Agent turn 开始前 | session, prompt | prompt（修改后）、system_prompt（追加） |
| `agent.after_turn` | Agent turn 完成后 | session, messages, result | summary |
| `tool.before_execute` | 任何工具执行前 | tool_name, args, session | args（修改后）、block（设为 true 以拒绝） |
| `tool.after_execute` | 工具完成后 | tool_name, args, result, session | result（修改后）、metadata |
| `message.received` | 收到新用户消息 | session, message | message（修改后） |
| `message.before_send` | 消息发送到 LLM 前 | session, messages | messages（转换后） |
| `permission.ask` | Agent 请求权限 | tool_name, details | decision: "allow" / "deny" / "ask_user" |
| `session.compacting` | 上下文压缩前 | session, context | instructions（追加到压缩提示词） |
| `theme.change` | 主题变更 | theme（dark/light） | N/A（仅通知） |

Hooks 在插件的 `mount()` 或模块导出中注册：

```typescript
export default createPlugin({
  mount(container, api) {
    api.hooks.on("tool.before_execute", ({ args }, output) => {
      if (args.file_path && !args.file_path.startsWith("/safe/")) {
        output.block = true  // 阻止不安全文件访问
      }
    })
  }
})
```

---

## 6. 安全审查管线

### 6.1 自动检查（安装时）

| 检查 | 描述 | 参考 |
|-------|-------------|-----------|
| **Manifest 验证** | 必需字段、正则、路径遍历检查 | CloudCLI L52-94 |
| **权限审计** | 验证声明权限匹配实际 API 使用（尽力静态分析） | -- |
| **npm audit** | 对插件依赖运行 `npm audit` | CloudCLI L341 `--ignore-scripts` |
| **已知漏洞扫描** | 对照 CVE 数据库检查插件版本 | -- |
| **恶意模式检测** | 扫描 `eval()`、`child_process.exec()`、对未知域的 `fetch()` | -- |
| **代码签名**（未来） | 验证插件发布者签名 | -- |

### 6.2 运行时沙箱

| 位类型 | 沙箱级别 | 机制 |
|-----------|-------------|-----------|
| `tab` / `panel` / `toolbar` | **iframe 隔离** | 插件 UI 在沙箱 iframe 中运行，使用 `sandbox="allow-scripts"`，通过 `postMessage` 桥通信 |
| `tool` | **Worker thread**（Node.js）或 **WASM**（浏览器） | 隔离执行上下文，默认无 fs/network |
| `skill` | **仅提示词** | 无代码执行；指令以文本方式注入 |
| `theme` | **仅 CSS** | 解析并消毒 CSS，不包含对外部资源的 `url()` |

### 6.3 Plugin Server Sidecar 隔离

对于有 `server` entry 的插件（CloudCLI 模式）：

- **环境**: 仅注入 `PATH`、`HOME`、`NODE_ENV`、`PLUGIN_NAME`（CloudCLI L32-37）
- **网络**: 仅 localhost（`127.0.0.1`），操作系统分配的端口
- **密钥**: 各插件密钥注入为 `X-Plugin-Secret-*` 请求头（CloudCLI L244-246）
- **进程生命周期**: SIGTERM（5s）→ SIGKILL 两阶段关闭（CloudCLI L111-136）
- **启动超时**: 10s ready 信号（CloudCLI L44-50）
- **并发保护**: Map<name, Promise> 防止重复启动（CloudCLI L21-23）

### 6.4 已发布插件的审查流程

```
1. 自动检查通过
2. 需要人工审查的条件:
   - 插件请求 system.process.spawn 或 fs.exec
   - 插件具有原生（二进制）依赖
   - 插件的 npm 依赖包含已知漏洞的包
3. 已审查的插件在市场中标为 "verified"
4. 未审查的插件显示 "community" 徽章 + 明确警告
```

---

## 7. MCP 导出（三层升级链）

来自 Langflow 的三层模型（langflow.md 第 4 节）：

```
Tier 1: Plugin tool（AgentHub 内部）
  slot: tool  →  注册在 Agent tool 注册表中

Tier 2: Agent tool（对 AgentHub agent 暴露）
  tool_mode: true  →  agent 可在 turns 中调用此工具
  （自动: 任何 slot=tool 插件对 agent 可见）

Tier 3: MCP tool（对外部 MCP 客户端暴露）
  export_mcp: true  →  工具出现在 MCP tools/list 中
  （AgentHub MCP server 将插件工具暴露给 Claude Code、Codex 等）
```

插件开发者编写一次工具。同一工具定义同时作为：
1. 内部 AgentHub 工具（用于 Hub 级自动化）
2. Agent 可调用工具（用于面向用户的 agent）
3. MCP 工具（用于通过 MCP 连接的外部 AI 工具）

无需代码变更。这是 Langflow `tool_mode=True` 模式应用于 AgentHub Runner 模型的关键洞察。

---

## 8. 对比: AgentHub 插件 vs 参考实现

| 维度 | CloudCLI | OpenCode | LibreChat | Langflow | **AgentHub（综合）** |
|-----------|----------|----------|-----------|----------|---------------------------|
| **位** | 1（tab） | N/A（仅 hooks） | N/A | Sidebar + Canvas | 6（tab、panel、toolbar、tool、skill、theme） |
| **注册** | manifest.json + git clone | init() + dynamic import | N/A | dynamic import + component_index | init() + manifest.yaml + 远程注册表 |
| **权限** | String array | Hierarchical merge（agent/user config） | Role-based sharing | N/A（同进程） | Three-tier intersection（manifest/user/policy） |
| **安装** | Atomic（tmp + rename） | Bun dynamic import + retry | N/A | N/A（monorepo） | Atomic + backup + rollback |
| **Hook 系统** | None（仅 RPC） | 19 bidirectional hooks | N/A | Graph lifecycle events | 9 essential bidirectional hooks |
| **沙箱** | Process isolation | TUI/server separation | N/A | Same process | Iframe（UI）+ Worker（tool）+ Process（sidecar） |
| **MCP 导出** | None | MCP as first-class citizen | MCP manager singleton | Three-tier（Agentic/Project/External） | Three-tier upgrade chain |
| **市场** | None | None | Agent grid + virtualized + sharing | Sidebar + Fuse.js search | Grid + virtualized + category + Fuse.js + sharing |

---

## 9. 实现优先级

| 阶段 | 任务 | 来源模式 |
|-------|------|---------------|
| **P0** | Manifest schema + 验证 | CloudCLI L52-94 |
| **P0** | Plugin registry（init + manifest scan） | design-adapter-sdk.md 第 3 节 |
| **P0** | 原子安装 + 卸载 | CloudCLI L250-368 |
| **P0** | 权限模型（声明 + 关口） | OpenCode L152-158 + CloudCLI L131 |
| **P1** | UI 位运行时（tab/panel/toolbar） | CloudCLI PluginTabContent |
| **P1** | Tool/Skill 位运行时 | OpenCode tool hook + librechat skill injection |
| **P1** | Server sidecar + ready 协议 + RPC proxy | CloudCLI 第 2.5 + 2.7 节 |
| **P1** | Plugin SDK（npm packages） | design-adapter-sdk.md App A |
| **P2** | 市场 UI（grid + search + detail） | LibreChat 第 1.6 节 |
| **P2** | Hook 系统（9 hooks） | OpenCode 第 1.2 节 |
| **P2** | MCP export tier | Langflow 第 4 节 |
| **P2** | 安全审查管线 | 上文第 6 节 |
| **P3** | 插件间依赖 | -- |
| **P3** | Code signing + verification | -- |
| **P3** | 远程插件注册表服务 | -- |

---

*设计完成。2026-05-21。*
