# Claude Agent SDK 最新调研 (2026-05)

> Claude Agent SDK 已 GA（Python + TypeScript），替代 CLI headless 成为 AgentHub 的推荐接入方式。

## 1. SDK 核心 API

### Python
```python
pip install claude-agent-sdk  # v0.1.56
```

```python
from claude_agent_sdk import query, ClaudeAgentOptions, ClaudeSDKClient

async for message in query(
    prompt="Fix the bug in auth.py",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Edit", "Bash", "Grep"],
        permission_mode="acceptEdits",
        max_turns=10,
        mcp_servers={...},
        hooks={"PreToolUse": [...]},
        agents={"reviewer": AgentDefinition(...)},
        resume="session-123",  # 恢复已有 session
    ),
):
    # 处理流式消息
```

### TypeScript
```bash
npm install @anthropic-ai/claude-agent-sdk
```

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Fix the bug in auth.py",
  options: {
    allowedTools: ["Read", "Edit", "Bash"],
    permissionMode: "acceptEdits",
  }
})) { /* ... */ }
```

## 2. ClaudeAgentOptions 完整字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `model` | string | 模型选择 (e.g. 'claude-sonnet-4-6') |
| `system_prompt` | string | 系统提示词 |
| `cwd` | string | 工作目录 |
| `max_turns` | int | 最大轮次 |
| `permission_mode` | string | 'default'/'acceptEdits'/'bypassPermissions'/'plan' |
| `allowed_tools` | list[str] | 自动批准的工具 |
| `disallowed_tools` | list[str] | 明确阻止的工具 |
| `mcp_servers` | dict | MCP server 配置 |
| **`hooks`** | dict | 生命周期 hooks (PreToolUse等) |
| **`agents`** | dict | Subagent 定义 — **AgentHub 群聊关键** |
| **`resume`** | str | Session ID — 恢复已有会话 |
| **`output_format`** | dict | JSON Schema 结构化输出 |
| `setting_sources` | list | 加载 skills/commands 的来源 |
| `enable_file_checkpointing` | bool | 文件变更追踪 |
| `canUseTool` | callback | 自定义权限回调 |

## 3. 对 AgentHub 的影响

### 之前的设计: CLI headless
```
Runner → exec.CommandContext("claude", "-p", prompt, "--output-format", "stream-json")
```

### 现在推荐: Agent SDK
```
Runner → subprocess(Python script using claude-agent-sdk)
       → query(prompt, options)
       → 流式 AgentEvent
```

**优势**:
1. `agents` 字段天然支持 Subagent 定义——AgentHub 的群聊 `@agent` 直接映射
2. `hooks` 字段支持 PreToolUse 审批拦截——AgentHub 的审批卡片可借 SDK hook 实现
3. `resume` 字段支持 session 续传——AgentHub 的 Thread 续接
4. `output_format` 支持 JSON Schema 结构化输出——AgentHub 的 Artifact 解析

### 部署模式
- Python SDK: Runner 通过 `exec.CommandContext` 调 Python 脚本
- TypeScript SDK: 如果需要 Node sidecar（但 AgentHub 后端是 Go，不直接用 TS SDK）
- 推荐: Python sidecar 模式——Runner 启动 Python 进程，stdin/stdout JSON-RPC 通信

## 4. ClaudeSDKClient（高级多轮对话）

```python
async with ClaudeSDKClient(options=options) as client:
    await client.query("What is in this repo?")
    async for msg in client.receive_response():
        print(msg)
    # Claude 记住上下文
    await client.query("Fix the tests")
    async for msg in client.receive_response():
        print(msg)
```

## 5. 资源
- 官方文档: https://code.claude.com/docs/en/agent-sdk/overview
- Python SDK: https://github.com/anthropics/claude-agent-sdk-python
- PyPI: `pip install claude-agent-sdk`
- 2026-06-15 起 Agent SDK 使用有独立 credit 配额
