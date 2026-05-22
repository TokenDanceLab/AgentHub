# AgentHub 调研文档索引

> 69 份文档，按"Agent 需要什么"分类。Agent 读文档路径：**Learn → Decide → Build → Plan**。
>
> 语言规则：本目录服务于 Agent 和实现阶段，也要逐步中文化。翻译按 [中文化路线图](../chinese-documentation-roadmap.md) 分批执行，保留代码、路径、协议字段和必要英文原文。完整规则见 [文档语言规则](../language-policy.md)。

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

## 02-decide — 对比选型

| # | 文件 | 决策主题 |
|---|------|----------|
| 01 | [adapters](02-decide/01-adapters.md) | Adapter 统一接口：4 核心 + 3 扩展 |
| 02 | [im-ux](02-decide/02-im-ux.md) | IM 产品定位光谱 + 20 借鉴建议 |
| 03 | [orchestration](02-decide/03-orchestration.md) | 4 种调度策略 + 四层防循环 |
| 04 | [sandbox-tools](02-decide/04-sandbox-tools.md) | 三级沙箱 + Tool 三层架构 |
| 05 | [undo-rollback](02-decide/05-undo-rollback.md) | Undo 粒度：Fork=Clone + Undo=Replace |
| 06 | [realtime-sync](02-decide/06-realtime-sync.md) | WebSocket / EventStore / 多端同步语义 |
| 07 | [permission-models](02-decide/07-permission-models.md) | 权限来源、审批模式、策略优先级 |

## 03-build — 拿着就能写代码

### backend（16 篇 Go 后端规格）
| # | 文件 | 内容 |
|---|------|------|
| 01 | [protocol](03-build/backend/01-protocol.md) | 早期 Go 类型建模参考；当前主协议入口见 `api/` |
| 02 | [go-services](03-build/backend/02-go-services.md) | Hub/Edge/Runner 三级 Go 服务拆包参考；目录以当前根目录为准 |
| 03 | [eventstore-memory](03-build/backend/03-eventstore-memory.md) | JSONL + Snapshot 2MB + FTS5 + 四层 Memory |
| 04 | [adapter-sdk](03-build/backend/04-adapter-sdk.md) | 7 步开发流程 + 3 种注册模式 + Checklist |
| 05 | [context-builder](03-build/backend/05-context-builder.md) | 6-step pipeline + 5 子接口（1199行） |
| 06 | [concurrency-limits](03-build/backend/06-concurrency-limits.md) | 4 频段优先级队列 + 信标限流 |
| 07 | [observability](03-build/backend/07-observability.md) | slog + 22 事件 + 13 模型定价 |
| 08 | [error-handling](03-build/backend/08-error-handling.md) | 37 ErrorCode + 3 轴分类 + 4 通道 UI |
| 09 | [testing-strategy](03-build/backend/09-testing-strategy.md) | 5 层测试 + Agent 对抗测试（1251行） |
| 10 | [graceful-degradation](03-build/backend/10-graceful-degradation.md) | 14 功能 × 4 故障模式 + 4 层重连 |
| 11 | [model-fallback](03-build/backend/11-model-fallback.md) | 3 层 fallback 链 + circuit breaker |
| 12 | [workspace-lifecycle](03-build/backend/12-workspace-lifecycle.md) | 4 阶段流水线 + 6 状态机 + WorkspacePool |
| 13 | [protobuf-schema](03-build/backend/13-protobuf-schema.md) | Protobuf / Connect-RPC 方案参考，不是当前 M0 主协议入口 |
| 14 | [scaffold-services](03-build/backend/14-scaffold-services.md) | go.mod + Makefile + CI + golangci |
| 15 | [websocket-reliability](03-build/backend/15-websocket-reliability.md) | WebSocket 可靠性、重连、去重、背压 |
| 16 | [hub-server-requirements](03-build/backend/16-hub-server-requirements.md) | Hub Server 中心 IM、好友、群聊、Agent 元数据、消息和任务路由需求 |

### frontend（14 篇前端规格）
| # | 文件 | 内容 |
|---|------|------|
| 01 | [desktop-ux](03-build/frontend/01-desktop-ux.md) | 80+ 组件树 + 10 Zustand store + 5 交互状态机（61KB） |
| 02 | [monorepo](03-build/frontend/02-monorepo.md) | pnpm + Turborepo + packages/ui |
| 03 | [agent-identity](03-build/frontend/03-agent-identity.md) | 5 种原型 + 9 Persona 模板 + 15 字段 Schema |
| 04 | [global-search](03-build/frontend/04-global-search.md) | 4 层范围 + BM25 加权 + Ctrl+K |
| 05 | [keyboard-shortcuts](03-build/frontend/05-keyboard-shortcuts.md) | 7 层键盘导航 + CustomEvent 分发 |
| 06 | [markdown-rendering](03-build/frontend/06-markdown-rendering.md) | Shiki + Mermaid DOMPurify + 流式 react-markdown |
| 07 | [micro-interactions](03-build/frontend/07-micro-interactions.md) | 6 动画 token + 4 缓动 + 7 状态转换 |
| 08 | [theme-system](03-build/frontend/08-theme-system.md) | OKLCH + CSS 变量 + Monaco 主题同步 |
| 09 | [accessibility](03-build/frontend/09-accessibility.md) | WCAG 2.2 AA 全量 + 19 项 reduced-motion |
| 10 | [data-portability](03-build/frontend/10-data-portability.md) | 3 格式导出 + 项目迁移 + 跨用户 Fork |
| 11 | [session-sharing](03-build/frontend/11-session-sharing.md) | 3 级权限 + 256-bit token + 过期 + 密码保护 |
| 12 | [cli-wizard](03-build/frontend/12-cli-wizard.md) | 10 命令 + 3 步向导 + doctor 诊断（950行） |
| 13 | [plugin-marketplace](03-build/frontend/13-plugin-marketplace.md) | 6 种 Slot + 5 类权限 + 原子安装（477行） |
| 14 | [performance-budget](03-build/frontend/14-performance-budget.md) | FCP<600ms + TTI<1.2s + 回归检测 |

## 04-plan — 规划排期

| # | 文件 | 内容 |
|---|------|------|
| 01 | [research-to-implementation](04-plan/01-research-to-implementation.md) | P0 最小系统 + 优先级矩阵 + 调研→实现映射 |
| 02 | [claude-sdk-impact](04-plan/02-claude-sdk-impact.md) | Claude Agent SDK GA 对架构的 5 项影响 |

## Agent 使用指南

```
我要写 Adapter → 03-build/backend/01-protocol.md + 04-adapter-sdk.md + 02-decide/01-adapters.md
我要写 API/事件契约 → ../../api/README.md + ../../api/openapi.yaml + ../../api/events.schema.json + ../protocol.md
我要写 EventStore → 03-build/backend/03-eventstore-memory.md + 01-learn/deep-dive/06-ccviewer-fts5.md
我要写前端消息流 → 03-build/frontend/01-desktop-ux.md + 02-decide/06-realtime-sync.md + 03-build/backend/15-websocket-reliability.md
我要做安全设计 → 02-decide/07-permission-models.md + 03-build/backend/08-error-handling.md + 01-learn/deep-dive/04-claude-code-tool-security.md
我要写工作台/worktree/diff → 01-learn/web-research/04-agent-command-center-2026.md + 03-build/backend/12-workspace-lifecycle.md + 03-build/frontend/01-desktop-ux.md
我要写 Hub Server IM/好友/群聊 → 03-build/backend/16-hub-server-requirements.md + 03-build/backend/02-go-services.md + ../architecture.md
我要了解竞品 → 01-learn/web-research/02-competitive-2026.md + 01-learn/web-research/04-agent-command-center-2026.md
我要定位 Multica → 01-learn/deep-dive/12-multica-product-ui.md + 01-learn/web-research/04-agent-command-center-2026.md + ../../reference/multica/README.md + ../../reference/multica/docs/product-overview.md
我要对齐比赛材料 → ../research/bytedance.md + 01-learn/web-research/04-agent-command-center-2026.md
我要看术语白话解释 → ../glossary.md
我要管理 GitHub issues → ../project-management.md
我要判断文档该用中文还是英文 → ../language-policy.md
我要执行文档中文化 → ../chinese-documentation-roadmap.md
```
