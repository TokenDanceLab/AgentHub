# AgentHub 参考项目调研文档

> 21 个参考项目，按问题域检索。Agent 路径：**按需求查找 → 直接进入相关文档**。

---

## 按问题找

| 我要做什么 | 入口文档 |
|------------|----------|
| 了解全貌（18 项目矩阵 + 模式收敛） | `cross-comparison/00-synthesis.md` |
| 学习最佳实践汇总 | `cross-comparison/10-best-practices-playbook.md` |
| 借鉴 UI 设计 | `projects/multica/` · `projects/opencode/` · `projects/lobehub/` |
| 研究安全架构 | `projects/claude-code-sdk/` · `cross-comparison/07-permission-models.md` |
| 设计 Agent 适配器 | `cross-comparison/01-adapters.md` |
| 研究 IM 消息树/Fork | `cross-comparison/02-im-ux.md` |
| 对比编排策略 | `cross-comparison/03-orchestration.md` |
| 沙箱和 Tool 架构 | `cross-comparison/04-sandbox-tools.md` |
| WebSocket/EventStore 同步 | `cross-comparison/06-realtime-sync.md` |
| 权限审批模型 | `cross-comparison/07-permission-models.md` |
| UI 美化方案 | `cross-comparison/08-ui-beautify-plan.md` |

---

| 项目 | 目录 | 文件 | 重点 |
|------|------|:--:|------|
| **Kanna** | `projects/kanna/` | 3 | Claude Code + Codex Web UI、Orchestrator 映射 |
| **LibreChat** | `projects/librechat/` | 2 | IM Agent 平台、消息树算法、Fork 机制 |
| **OpenCode** | `projects/opencode/` | 3 | 19 Hook 插件、24 包 monorepo、UI 借鉴 |
| **Claude Code SDK** | `projects/claude-code-sdk/` | 3 | 28 Hook + Zod、23 安全检查、上下文压缩 |
| **LobeHub** | `projects/lobehub/` | 2 | **最接近对标**：Agent 编排、图标库、Hub 设计 |
| **Multica** | `projects/multica/` | 2 | 产品模型、竞品格局、Agent 命令中心 |
| **OpenHands** | `projects/openhands/` | 2 | 三级沙箱、Agent 协议、SDK 四包 |
| **OpCode** | `projects/opcode/` | 1 | Tauri 桌面 GUI、Checkpoint/Undo |
| **Codex CLI** | `projects/codex-cli/` | 1 | 树形 Multi-Agent、SQ/EQ 队列 |
| **Langflow + Flowise** | `projects/langflow-flowise/` | 3 | 可视化编排、MCP 三级链、Supervisor |
| **Dify** | `projects/dify/` | 2 | Tool Provider、OSL 风险 |
| **ChatDev** | `projects/chatdev/` | 2 | YAML 配置驱动、FIELD_SPECS 元驱动 |
| **Claude Code Viewer** | `projects/claude-code-viewer/` | 2 | FTS5 搜索、Diff 展示、PWA |
| **CloudCLI** | `projects/cloudcli/` | 1 | 多 CLI 会话管理、插件系统 |
| **Claude Code WebUI** | `projects/claude-code-webui/` | 1 | 最轻 Claude Web 壳 |
| **Goose** | `projects/goose/` | 1 | Agent 运行时、MCP 集成 |
| **MindFS** | `projects/mindfs/` | 1 | Agent 文件系统抽象 |
| **CC Switch** | `projects/cc-switch/` | 1 | Provider/模型路由、Circuit Breaker |

## cross-comparison/ — 二次对比研究

| # | 文件 | 内容 |
|:--:|------|------|
| 00 | [synthesis](cross-comparison/00-synthesis.md) | **总报告**：18 项目矩阵 + 6 大模式收敛 + P0/P1/P2 路线图 |
| 01 | [adapters](cross-comparison/01-adapters.md) | Agent 适配器接口统一设计 |
| 02 | [im-ux](cross-comparison/02-im-ux.md) | IM 产品定位 + 20 条 UI 借鉴建议 |
| 03 | [orchestration](cross-comparison/03-orchestration.md) | 4 种编排策略对比 |
| 04 | [sandbox-tools](cross-comparison/04-sandbox-tools.md) | 三级沙箱 + Tool 三层架构 |
| 05 | [undo-rollback](cross-comparison/05-undo-rollback.md) | Undo/Fork/Checkpoint 机制 |
| 06 | [realtime-sync](cross-comparison/06-realtime-sync.md) | WebSocket/EventStore/多端同步 |
| 07 | [permission-models](cross-comparison/07-permission-models.md) | 权限审批模型对比 |
| 08 | [ui-beautify-plan](cross-comparison/08-ui-beautify-plan.md) | AgentHub UI 美化 18 天计划 |
| 09 | [prompt-engineering](cross-comparison/09-prompt-engineering.md) | Prompt/Rules/Skills 模式提取 |

## web-research/ — 生态调研

| # | 文件 | 内容 |
|:--:|------|------|
| 01 | [tech-stack](web-research/01-tech-stack.md) | Go/Tauri/WebSocket/SQLite 选型参考 |
| 03 | [claude-agent-sdk](web-research/03-claude-agent-sdk.md) | Claude Agent SDK GA 分析 |
| 04 | [agent-command-center](web-research/04-agent-command-center-2026.md) | Emdash/Orca/Jean/Crush/ECA/Goose |

## planning/ — 规划排期

| # | 文件 | 内容 |
|:--:|------|------|
| 01 | [research-to-implementation](planning/01-research-to-implementation.md) | P0 最小系统 + 优先级矩阵 |
| 02 | [claude-sdk-impact](planning/02-claude-sdk-impact.md) | Claude SDK GA 对架构的 5 项影响 |

---

## Agent 使用指南

```
我要了解全貌 → cross-comparison/00-synthesis.md
我要看某个项目 → projects/<project>/
我要做架构决策 → cross-comparison/01-07（按维度找）
我要写 UI → cross-comparison/08-ui-beautify-plan.md + projects/opencode/03-ui-adoption.md
我要对标产品 → projects/lobehub/ + projects/multica/
我要做安全 → projects/claude-code-sdk/02-tool-security.md + cross-comparison/07-permission-models.md
```
