# 04 - AionUi Agent 编排模型

## Agent 类型体系

### 检测到的 Agent 种类（`DetectedAgentKind`）

```
src/common/types/detectedAgent.ts

DetectedAgentKind:
├── acp           # 标准 ACP 协议 Agent（Claude Code, Codex, OpenCode, Qwen Code...）
├── gemini        # Google Gemini CLI
├── aionrs        # AionUi 内置 Rust Agent
├── openclaw      # OpenClaw Agent
├── nanobot       # Nanobot Agent
└── remote        # 远程 Agent（通过 HTTP/WS 连接）
```

### Agent 注册与发现

```
AgentRegistry (src/process/agent/AgentRegistry.ts)
│
├── detectAll(): DetectedAgent[]
│   ├── AcpDetector  → 扫描 PATH 中的 ACP 兼容 CLI
│   ├── Gemini CLI   → 检测 gemini 命令
│   ├── OpenClaw     → 检测 openclaw 配置
│   ├── Nanobot      → 检测 nanobot 安装
│   └── Remote       → 手动配置的远程 Agent
│
├── createAdapter(kind): IAgentAdapter
│   ├── AcpAdapter       ← 通用 ACP 适配器
│   ├── GeminiAdapter    ← Gemini 专用适配器
│   ├── OpenClawAdapter ← OpenClaw 专用
│   ├── AionrsAdapter    ← 内置 Agent
│   ├── NanobotAdapter   ← Nanobot
│   └── RemoteAdapter    ← 远程 Agent
│
└── getCapabilities(kind): AgentCapabilities
    ├── tools: string[]
    ├── models: string[]
    └── features: AgentFeature[]
```

### ACP 协议适配层（核心）

```
src/process/agent/acp/

AcpAdapter           # 高层接口，管理连接生命周期
├── AcpConnection    # 单个 Agent 连接
│   ├── start()      # spawn child process / connect HTTP
│   ├── send()       # 发送用户消息
│   ├── abort()      # 中断当前运行
│   └── close()      # 关闭连接
├── AcpDetector      # CLI 扫描与识别
│   ├── scanPath()        # 扫描 PATH 环境变量
│   ├── detectConfig()    # 解析 CLI 配置（支持的协议、模型）
│   └── resolveBinary()   # 确定二进制路径
├── ApprovalStore     # 审批状态持久化
├── mcpSessionConfig  # MCP 配置注入
└── modelInfo         # 模型信息查询
```

## 工具调用流程（含审批分叉）

```
Agent 发起工具调用
       │
       ▼
┌─────────────────────────────────────────────────┐
│           AcpSession.onToolCall()               │
│                                                  │
│  1. 解析工具调用请求（tool_name, args）          │
│  2. 查询审批策略：                               │
│     ├── YOLO Mode → autoApprove()               │
│     ├── Auto Mode → checkRisk(tool)              │
│     │   ├── LOW risk → autoApprove()             │
│     │   └── HIGH risk → requestApproval()        │
│     └── Manual → requestApproval()               │
│  3. 执行或挂起                                   │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
   ┌─────────┐          ┌──────────┐
   │  AUTO   │          │ APPROVAL │
   │ APPROVE │          │ REQUIRED │
   └────┬────┘          └────┬─────┘
        │                    │
        │              ┌─────┴─────┐
        │              │           │
        │              ▼           ▼
        │          [Approve]   [Deny]
        │              │           │
        │              │           ▼
        │              │      ┌──────────┐
        │              │      │ DENIED   │
        │              │      │(通知Agent│
        │              │      │ 拒绝原因)│
        │              │      └──────────┘
        │              │
        ▼              ▼
   ┌──────────────────────────┐
   │      EXECUTE TOOL        │
   │                           │
   │  1. 解析工具类型          │
   │  2. 路由到执行器:         │
   │     ├── FileRead/Write → fs 操作
   │     ├── ShellCmd → child_process
   │     ├── WebFetch → HTTP request
   │     ├── WebSearch → search API
   │     ├── MCPTool → MCP client
   │     └── BuiltinSkill → skill executor
   │  3. 捕获输出/错误         │
   │  4. 返回结果给 Agent      │
   └──────────────────────────┘
```

### 风险分级（YOLO/Auto 模式）

| 风险等级 | 示例工具 | YOLO | Auto | Manual |
|----------|----------|------|------|--------|
| LOW | read_file, list_dir, web_search | 自动 | 自动 | 审批 |
| MEDIUM | write_file, run_shell(safe) | 自动 | 审批 | 审批 |
| HIGH | delete_file, run_shell(any), http_post | 自动 | 审批 | 审批 |
| CRITICAL | rm -rf, sudo, eval | 自动 | 审批 | 审批 |

## 多 Agent 协作机制（Team Mode）

### 架构模型：Leader-Teammate

```
                      ┌──────────┐
                      │  USER    │
                      └────┬─────┘
                           │ 指令
                           ▼
                   ┌──────────────┐
                   │   LEADER     │ ← Claude Code / Codex / Gemini / Aion CLI
                   │  (主 Agent)  │
                   └──────┬───────┘
                          │ 拆解任务
            ┌─────────────┼─────────────┐
            │             │             │
            ▼             ▼             ▼
      ┌──────────┐ ┌──────────┐ ┌──────────┐
      │Teammate 1│ │Teammate 2│ │Teammate 3│ ← ACP / Gemini / aionrs
      │(前端开发)│ │(后端开发)│ │(测试)    │
      └────┬─────┘ └────┬─────┘ └────┬─────┘
           │            │            │
           └────────────┼────────────┘
                        │ 结果汇总
                        ▼
              ┌──────────────────┐
              │   TeamMcpServer  │ ← 内嵌 MCP Server
              │                  │    提供团队协调 tools:
              │  - assign_task   │    Leader 调用分配任务
              │  - send_message  │    Agent 间异步通信
              │  - read_mailbox  │    读取消息
              │  - report_result │    汇报结果
              │  - get_status    │    查询 Teammate 状态
              └──────────────────┘
```

### Team 通信机制

```
TeamSession (src/process/team/TeamSession.ts)
├── Mailbox          # 异步消息邮箱
│   ├── send(from, to, message)
│   ├── read(agentId): Message[]
│   └── onMessage(agentId, callback)
├── TaskManager      # 任务分配和追踪
│   ├── createTask(description, assignee?)
│   ├── updateStatus(taskId, status)
│   └── getBoard(): Task[]
├── TeammateManager  # Teammate 生命周期
│   ├── spawn(agentType, model) → TeamAgent
│   ├── remove(slotId)
│   ├── wake(slotId)
│   └── getAgents(): TeamAgent[]
└── TeamMcpServer    # MCP Server (提供协调工具给 Leader)
```

### Teammate 状态机

```
                    ┌──────────┐
                    │ OFFLINE  │
                    └────┬─────┘
                         │ spawn()
                         ▼
                    ┌──────────┐
              ┌─────│  IDLE   │─────┐
              │     └────┬─────┘     │
              │          │ task      │
              │          ▼           │
              │     ┌──────────┐     │
              │     │ WORKING  │     │
              │     └────┬─────┘     │
              │          │           │
              │     ┌────┴────┐      │
              │     │         │      │
              │     ▼         ▼      │
              │ ┌──────┐ ┌────────┐  │
              │ │DONE  │ │ FAILED │  │
              │ └──┬───┘ └───┬────┘  │
              │    │          │       │
              └────┴──────────┴───────┘
                    │          │
                    ▼          ▼
              ┌──────────┐ ┌──────────┐
              │  IDLE    │ │  IDLE    │ ← 完成/失败后回到空闲
              └──────────┘ └──────────┘

特殊状态:
  SILENT → 长时间无响应，自动标记 FAILED
  AWAITING_APPROVAL → 等待用户审批（挂起但不释放）
```

## 上下文管理策略

### 会话上下文

- **独立上下文**：每个 Agent 会话维护独立的上下文窗口
- **上下文压缩**：通过 ACP 协议的 `contextUsage` 报告 token 使用量
- **会话持久化**：SQLite 存储完整消息历史（`messages` 表）
- **Fork 机制**：`AcpSession.fork()` 从任意消息点创建分支会话

### MCP 上下文

- **统一 MCP 配置**：一处配置，自动同步到所有 Agent
- **按需加载**：Agent 启动时注入 MCP session 配置
- **工具发现**：Agent 通过 MCP `tools/list` 动态发现可用工具

## 错误恢复机制

### Agent 层

```
异常处理层次:

1. Stream 中断 → streamResilience 自动重连（Gemini）
2. ACP 超时 → 重试 3 次后标记 FAILED
3. Agent 进程崩溃 → AgentRegistry 检测退出码，提示重启
4. MCP Server 崩溃 → 自动重启（最多 3 次）
5. 工具调用失败 → 错误返回给 Agent，Agent 自行决策
```

### Team 层

```
Team 级别容错:

- 单 Teammate 崩溃 → 不影响其他 Teammate + Leader
- 任务超时 → TaskManager 标记 FAILED，通知 Leader 重新分配
- MCP Server 断连 → Leader 工具调用失败，自动重连
- Mailbox 消息丢失 → SQLite 持久化保证不丢
```

## 对 AgentHub 的关键参考价值

1. **ACP 协议标准化**：`@agentclientprotocol/sdk` 是 AgentHub 应该支持的开放标准
2. **Team Mode 架构**：Leader-Teammate + MCP 协调的模式可直接借鉴用于 M4
3. **Agent 自动发现**：PATH 扫描 + 配置检测比手动配置更友好
4. **审批分级**：YOLO/Auto/Manual 三级比二元审批更灵活
5. **MCP 统一管理**：一处配置多 Agent 共享，减少重复配置
