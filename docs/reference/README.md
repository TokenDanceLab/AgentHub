# AgentHub 调研文档索引

> 按"Agent 需要什么"组织。Agent 路径：**Learn → Compare → Plan**。
>
> 当前入口：先看三份主文档，需要细节时进入本目录。
>
> - [产品需求文档](../product-requirements.md)
> - [系统架构文档](../system-architecture.md)
> - [功能实现文档](../implementation-guide.md)
> - [API 契约](../../api/)
> - [二次对比研究总报告](02-cross-comparison/00-synthesis.md) — **Start here for cross-project insights**

## 01-learn — 了解别人怎么做

### repos（14 篇单仓库深度报告）
| # | 文件 | 仓库 |
|---|------|------|
| 01 | [kanna](01-learn/repos/01-kanna.md) | Claude Code + Codex Web UI |
| 02 | [cloudcli](01-learn/repos/02-cloudcli.md) | 多 CLI 会话管理器 + 插件系统 |
| 03 | [claude-code-viewer](01-learn/repos/03-claude-code-viewer.md) | 会话历史 + Diff + PWA |
| 04 | [claude-code-webui](01-learn/repos/04-claude-code-webui.md) | 最轻 Claude Web 壳 |
| 05 | [opcode](01-learn/repos/05-opcode.md) | Tauri 桌面 GUI + Checkpoint |
| 06 | [opencode](01-learn/repos/06-opencode.md) | Plugin 19 Hooks + LLM Route |
| 07 | [librechat](01-learn/repos/07-librechat.md) | IM Agent 平台 + Subagent |
| 08 | [openhands](01-learn/repos/08-openhands.md) | Sandbox + SDK 四包 |
| 09 | [langflow](01-learn/repos/09-langflow.md) | 可视化编排 + MCP |
| 10 | [flowise](01-learn/repos/10-flowise.md) | Agentflow V2 Supervisor |
| 11 | [dify](01-learn/repos/11-dify.md) | Tool Provider + OSL 风险 |
| 12 | [chatdev](01-learn/repos/12-chatdev.md) | YAML Workflow 配置驱动 |
| 13 | [codex-cli](01-learn/repos/13-codex-cli.md) | 树形 Multi-Agent + app-server |
| 14 | [claude-code-sdk](01-learn/repos/14-claude-code-sdk.md) | 28 Hooks + Zod Schema + SDK |

### deep-dive（12 篇源码深度分析）
| # | 文件 | 分析主题 |
|---|------|----------|
| 01 | [kanna-orchestrator](01-learn/deep-dive/01-kanna-orchestrator.md) | Kanna AgentCoordinator→AgentHub 精确行号映射 |
| 02 | [librechat-message-tree](01-learn/deep-dive/02-librechat-message-tree.md) | buildTree 算法 + SiblingSwitch + Fork |
| 03 | [opencode-monorepo](01-learn/deep-dive/03-opencode-monorepo.md) | 22-package 分层依赖图 |
| 04 | [claude-code-tool-security](01-learn/deep-dive/04-claude-code-tool-security.md) | 23 安全检查→Go 函数签名 |
| 05 | [context-compaction](01-learn/deep-dive/05-context-compaction.md) | 4 层压缩算法 + reserveRatio |
| 06 | [ccviewer-fts5](01-learn/deep-dive/06-ccviewer-fts5.md) | FTS5 trigram tokenizer + BM25 |
| 07 | [chatdev-yaml-syntax](01-learn/deep-dive/07-chatdev-yaml-syntax.md) | 三层配置驱动语法提取 |
| 08 | [dify-tool-provider](01-learn/deep-dive/08-dify-tool-provider.md) | Python match→Go switch 翻译 |
| 09 | [langflow-flowise-mcp](01-learn/deep-dive/09-langflow-flowise-mcp.md) | MCP 三级链 + Supervisor 协议 |
| 10 | [openhands-agent-protocol](01-learn/deep-dive/10-openhands-agent-protocol.md) | WebSocket 事件流 + REST 兜底 |
| 11 | [prompt-engineering-patterns](01-learn/deep-dive/11-prompt-engineering-patterns.md) | Prompt / Rules / Skills 模式提取 |
| 12 | [multica-product-ui](01-learn/deep-dive/12-multica-product-ui.md) | Multica 产品模型、运行生命周期、前端包边界、设计系统 |

### web-research（4 篇 Web 生态调研）
| # | 文件 | 主题 |
|---|------|------|
| 01 | [tech-stack](01-learn/web-research/01-tech-stack.md) | Go/Tauri/WebSocket/SQLite/Buf 选型参考，当前主协议见 `api/` |
| 02 | [competitive-2026](01-learn/web-research/02-competitive-2026.md) | Ruflo/Multica/Paperclip 竞品格局 |
| 03 | [claude-agent-sdk](01-learn/web-research/03-claude-agent-sdk.md) | Claude Agent SDK GA 分析 |
| 04 | [agent-command-center-2026](01-learn/web-research/04-agent-command-center-2026.md) | Emdash/Orca/Jean/Crush/ECA/Goose 等新增参考综合 |

## 02-cross-comparison — 二次对比研究（跨项目模式收敛）

**入口：[00-synthesis.md](02-cross-comparison/00-synthesis.md)** — 18 项目全景矩阵 + 6 大跨项目模式 + 采纳优先级总表

| # | 文件 | 决策主题 |
|---|------|----------|
| — | [00-synthesis](02-cross-comparison/00-synthesis.md) | **总报告**：项目矩阵、模式收敛、采纳路线图 |
| 01 | [adapters](02-decide/01-adapters.md) | Adapter 统一接口：4 核心 + 3 扩展 |
| 02 | [im-ux](02-decide/02-im-ux.md) | IM 产品定位光谱 + 20 借鉴建议 |
| 03 | [orchestration](02-decide/03-orchestration.md) | 4 种调度策略 + 四层防循环 |
| 04 | [sandbox-tools](02-decide/04-sandbox-tools.md) | 三级沙箱 + Tool 三层架构 |
| 05 | [undo-rollback](02-decide/05-undo-rollback.md) | Undo 粒度：Fork=Clone + Undo=Replace |
| 06 | [realtime-sync](02-decide/06-realtime-sync.md) | WebSocket / EventStore / 多端同步语义 |
| 07 | [permission-models](02-decide/07-permission-models.md) | 权限来源、审批模式、策略优先级 |

## 03-archive — 历史规格（已归档）

> `03-build/` 的 30 份实现规格已归档至 [../archive/build-specs/](../archive/build-specs/)。这些是 M1-M3 阶段的预实现设计文档，代码已偏离，仅作历史参考。

## 04-plan — 规划排期

| # | 文件 | 内容 |
|---|------|------|
| 01 | [research-to-implementation](04-plan/01-research-to-implementation.md) | P0 最小系统 + 优先级矩阵 + 调研→实现映射 |
| 02 | [claude-sdk-impact](04-plan/02-claude-sdk-impact.md) | Claude Agent SDK GA 对架构的 5 项影响 |

## Agent 使用指南

```
我要看总览/采纳优先级 → 02-cross-comparison/00-synthesis.md（二次对比研究总报告）
我要写 Adapter → 02-decide/01-adapters.md + 01-learn/repos/14-claude-code-sdk.md + edge-server/internal/adapters/
我要做安全 → 02-decide/07-permission-models.md + 01-learn/deep-dive/04-claude-code-tool-security.md
我要做编排 → 02-decide/03-orchestration.md + 01-learn/deep-dive/02-librechat-message-tree.md
我要写 UI → 02-decide/02-im-ux.md + 01-learn/repos/01-kanna.md
我要看竞品 → 01-learn/web-research/02-competitive-2026.md + 02-cross-comparison/00-synthesis.md
我要看 Multica → 01-learn/deep-dive/12-multica-product-ui.md + 01-learn/web-research/04-agent-command-center-2026.md
我要看历史方案/旧规格 → ../archive/
我要看 API 契约 → ../../api/
```
