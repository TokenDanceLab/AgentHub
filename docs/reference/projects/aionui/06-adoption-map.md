# 06 - AgentHub 采纳映射

> 从 AionUi 的架构和实现中提取可采纳到 AgentHub 的具体方案。
> 格式：AionUi 做法（源码位置）→ AgentHub 当前状态 → 采纳方案 → 优先级 + 工作量。

---

## 1. Agent 自动发现

### 参考做法
- `src/process/agent/acp/AcpDetector.ts` — PATH 扫描 + 配置文件检测
- `src/common/types/detectedAgent.ts` — 统一 Agent 类型定义

### AgentHub 当前状态
- Agent 手动配置（`edge-server` 中的 adapter 配置）
- 无自动发现机制

### 采纳方案
在 `edge-server/adapters/` 下新增 `agent_detector.go`：
1. 实现 PATH 扫描：`exec.LookPath` 检测已知 CLI（claude, codex, gemini, openclaw...）
2. 实现配置探测：读取 CLI 配置文件判断支持的协议和模型
3. Edge Server 启动时自动注册检测到的 Agent
4. 通过 WebSocket 事件上报给 Hub Server

### 优先级 & 工作量
- **优先级**：P1（M3b）
- **工作量**：3-5 天（Go 实现 + API 事件）

---

## 2. ACP 协议支持

### 参考做法
- `src/process/acp/` — 完整的 ACP 协议实现
- `@agentclientprotocol/sdk` v0.18 — 开放标准
- `src/process/agent/acp/AcpAdapter.ts` — 通过 ACP 适配 16+ CLI Agent

### AgentHub 当前状态
- 各 Agent 使用自定义 adapter（无统一协议）
- 每新增一个 Agent 需写新 adapter

### 采纳方案
1. 在 `edge-server/adapters/` 下实现 `acp_adapter.go`，对接 ACP 开放协议
2. 现有 Claude Code / Codex adapter 逐步迁移到 ACP 接口
3. 新增 Agent 只需实现 ACP client 端

### 优先级 & 工作量
- **优先级**：P1（M4）
- **工作量**：5-8 天（协议实现 + adapter 迁移 + 测试）

---

## 3. Team Mode（多 Agent 协作）

### 参考做法
- `src/process/team/TeamSession.ts` — Leader-Teammate 协调器
- `src/process/team/Mailbox.ts` — 异步消息邮箱
- `src/process/team/TaskManager.ts` — 任务分配和追踪
- `src/process/team/TeamMcpServer.ts` — MCP Server 提供协调工具
- `src/process/team/TeammateManager.ts` — Agent 生命周期管理

### AgentHub 当前状态
- 无多 Agent 协作模式
- Hub-Edge 架构已支持多 Agent 连接，但无编排层
- 路线图 M4 阶段目标

### 采纳方案
在 `hub-server/` 下新增 `orchestration/` 包：

1. **TeamSession** → `hub-server/orchestration/team_session.go`
   - 基于 AgentHub 现有 Session 模型扩展
   - Leader 由用户指定或自动选举

2. **TaskManager** → `hub-server/orchestration/task_manager.go`
   - 任务 CRUD + 状态追踪
   - 利用现有 `messages` 表扩展任务字段

3. **Mailbox** → `hub-server/orchestration/mailbox.go`
   - Agent 间异步消息
   - 利用现有 WebSocket 推送

4. **Team MCP** → `hub-server/orchestration/team_mcp.go`
   - 提供 `assign_task`、`send_message`、`report_result` 等 MCP tools
   - Leader 通过 MCP 调用协调 Teammate

### 优先级 & 工作量
- **优先级**：P0（M4 核心功能）
- **工作量**：10-15 天（完整 Team 编排 + MCP tools + 前端 Team 页面）

---

## 4. 审批分级（YOLO/Auto/Manual）

### 参考做法
- `src/process/agent/acp/ApprovalStore.ts` — 审批策略持久化
- 三级模式：YOLO（全自动）/ Auto（风险分级）/ Manual（每步审批）
- 工具风险分级：LOW / MEDIUM / HIGH / CRITICAL
- 白名单机制："Always allow this type"

### AgentHub 当前状态
- 二元审批（批准/拒绝）
- 无风险分级
- 无白名单

### 采纳方案
1. `edge-server/approval/` 下新增 `risk_engine.go`
   - 定义工具风险分级规则
   - 支持用户自定义风险阈值

2. `hub-server/` 下新增 `approval_policy` 表
   - 存储用户审批策略和规则
   - 同步到 Edge Server

3. 前端 `app/desktop/` 新增审批策略配置 UI

### 优先级 & 工作量
- **优先级**：P1（M3b）
- **工作量**：3-5 天（后端 engine + 前端配置页）

---

## 5. MCP 统一管理

### 参考做法
- `src/process/services/mcp/` — MCP Server 注册、配置、生命周期
- 一处配置，自动同步到所有 Agent
- `src/process/agent/acp/mcpSessionConfig.ts` — MCP 配置注入

### AgentHub 当前状态
- MCP 支持已有基础（`edge-server` 中的 MCP 相关代码）
- 但配置分散在各 Agent adapter 中

### 采纳方案
1. `edge-server/mcp/` 下新增 `mcp_registry.go`
   - 统一 MCP Server 注册和配置管理
   - 支持 stdio 和 HTTP 两种 MCP transport

2. 各 Agent adapter 从 registry 获取 MCP 配置
   - 不需要每个 adapter 单独配置

### 优先级 & 工作量
- **优先级**：P2（M4）
- **工作量**：3-5 天

---

## 6. Extension 系统

### 参考做法
- `src/process/extensions/ExtensionRegistry.ts` — 扩展注册、生命周期
- `src/process/extensions/sandbox/sandbox.ts` — Worker Thread 沙箱
- `src/process/extensions/sandbox/permissions.ts` — 声明式权限
- `src/process/extensions/lifecycle/` — 激活/停用/卸载 hooks

### AgentHub 当前状态
- 无扩展系统
- 所有功能硬编码

### 采纳方案
AgentHub 当前阶段**不采纳**。理由：
- Extension 系统增加显著复杂度
- AgentHub 仍在核心功能建设阶段
- 待 M4 完成后再评估

### 优先级 & 工作量
- **优先级**：P3（M5+）
- **决策**：暂不采纳，M5 重新评估

---

## 7. Cron 定时自动化

### 参考做法
- `src/process/services/cron/CronService.ts` — 定时任务引擎
- `src/process/services/cron/CronStore.ts` — 任务持久化
- `src/process/services/cron/WorkerTaskManagerJobExecutor.ts` — Agent 任务执行
- `src/renderer/pages/cron/` — 前端配置界面

### AgentHub 当前状态
- 无定时任务功能
- 路线图中未明确排期

### 采纳方案
1. `hub-server/scheduler/` 下新增定时任务引擎
   - 支持 cron 表达式
   - 任务到期时触发 Agent 执行

2. 前端 `app/desktop/` 新增 Cron 配置页面

### 优先级 & 工作量
- **优先级**：P2（M5）
- **工作量**：5-8 天

---

## 8. IM 通道集成

### 参考做法
- `src/process/channels/` — 通道管理器
- `ext-feishu/`、`ext-wecom-bot/` — 飞书、企业微信扩展
- 支持 Telegram、DingTalk、WeChat 等

### AgentHub 当前状态
- 无 IM 集成
- 用户只能通过 Web/Desktop 交互

### 采纳方案
1. `hub-server/channels/` 下新增 IM 通道框架
   - 统一消息收发接口
   - 首期支持 Telegram Bot（API 最简单）

2. AgentHub IM 集成优先走 Hub Server（不走 Edge）
   - Hub Server 已有 WebSocket，可直接桥接 IM ↔ Agent

### 优先级 & 工作量
- **优先级**：P2（M5）
- **工作量**：5-8 天（框架 + Telegram 首通道）

---

## 9. 内置 Web 服务器（远程访问）

### 参考做法
- `src/process/webserver/` — Express HTTP 服务器
- WebUI 模式：`npm run webui` 启动纯 Web 模式
- 密码保护 + Token 认证

### AgentHub 当前状态
- Hub Server 已提供 HTTP API
- Web 前端 `app/web/` 可通过浏览器访问
- 但无端到端 WebUI 模式（依赖 Desktop 启动 Agent）

### 采纳方案
AgentHub 已具备此能力，无需额外采纳。可参考 AionUi 的远程访问用户流程优化登录体验。

### 优先级 & 工作量
- **优先级**：P3
- **决策**：已有能力，仅参考 UX 优化

---

## 10. 文件面板（常驻 Workspace 浏览）

### 参考做法
- 对话界面常驻右侧文件面板
- 实时显示 Agent 工作区文件树
- 支持点击预览文件内容

### AgentHub 当前状态
- Workspace 概念已有
- 但前端无文件浏览 UI

### 采纳方案
1. `app/shared/src/ui/` 新增 `FileTree` 和 `FilePreview` 组件
2. Edge Server 已有 workspace 文件列表 API，前端对接即可

### 优先级 & 工作量
- **优先级**：P1（M3b）
- **工作量**：2-3 天（UI 组件 + API 对接）

---

## 不采纳清单

| 项 | 理由 |
|----|------|
| Electron 桌面框架 | AgentHub 已选 Tauri，不切换 |
| Arco Design 组件库 | AgentHub 已有 Semi-UI，不混用 |
| Bun 运行时 | AgentHub 后端用 Go，前端用 Node.js |
| aionrs CLI（Rust Agent） | AgentHub 有自己的 Agent 引擎 |
| Pet 桌面宠物 | 趣味功能，非优先级 |
| Extension 系统（当前阶段） | M5+ 重新评估 |
| 内置 Office 助手（PPT/Word/Excel） | AgentHub 定位不同，不需要 |

---

## 优先级汇总

| 序号 | 采纳项 | 优先级 | 工作量 | 目标里程碑 |
|------|--------|--------|--------|------------|
| 3 | Team Mode 多 Agent 协作 | P0 | 10-15d | M4 |
| 1 | Agent 自动发现 | P1 | 3-5d | M3b |
| 4 | 审批分级 | P1 | 3-5d | M3b |
| 10 | 文件面板 UI | P1 | 2-3d | M3b |
| 2 | ACP 协议支持 | P1 | 5-8d | M4 |
| 5 | MCP 统一管理 | P2 | 3-5d | M4 |
| 7 | Cron 定时自动化 | P2 | 5-8d | M5 |
| 8 | IM 通道集成 | P2 | 5-8d | M5 |
| 6 | Extension 系统 | P3 | — | M5+ |
| 9 | WebUI 远程访问 | P3 | — | 已有 |
