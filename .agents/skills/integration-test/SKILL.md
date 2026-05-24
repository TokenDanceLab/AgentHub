---
name: integration-test
description: 运行 AgentHub 集成 E2E 测试 — 启动 Edge + Claude Code/OpenCode + WebSocket 验证。Agent 应在改完 adapter/executor/event pipeline 后主动使用。
---

# Integration Test

启动真实 Edge Server，通过 Claude Code（或 OpenCode）运行 prompt，验证完整事件管道。

## 快速运行

```powershell
# 先构建（首次）
cd edge-server; go build -o $env:TEMP\agenthub-edge-e2e.exe .\cmd\agenthub-edge\

# Claude Code（需要 claude 在 PATH）
.\scripts\integration-e2e.ps1 -SkipBuild -Agent claude-code

# OpenCode（需要 OPENCODE_PATH 环境变量）
$env:OPENCODE_PATH = "path\to\opencode"
.\scripts\integration-e2e.ps1 -SkipBuild -Agent opencode
```

期望：5/5 pass（Server 接受 → 收到 text → 收到 result → Run 完成 → 事件总数 > 5）

## 断言说明

| # | 断言 | 失败原因 |
|---|------|---------|
| 1 | Server accepted run | Edge 未启动或 project/thread 创建失败 |
| 2 | Received text events | Agent 无输出（API key/模型不可用） |
| 3 | Received result event | Agent 未正常完成 |
| 4 | Run finished successfully | Agent 执行失败（检查 stderr） |
| 5 | Total events received | WebSocket 断开或事件丢失 |

## 已知限制

- OpenCode/Codex 需要各自 CLI 配置 API key
- 工具调用场景超时较长（30s+），简单 prompt 更快
- Windows 上需 PowerShell 7+
