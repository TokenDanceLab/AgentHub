# reference 仓库索引

> `reference/` 存放 clone 下来的第三方仓库，只用于调研。除本索引外，目录内源码和文档默认不翻译、不改写。

## 阅读入口

- 调研报告入口：[docs/reference/README.md](../docs/reference/README.md)
- 三份主文档：[产品需求](../docs/product-requirements.md)、[系统架构](../docs/system-architecture.md)、[功能实现](../docs/implementation-guide.md)
- API 契约：[api/README.md](../api/README.md)

## 重点参考

| 优先级 | 仓库 | 路径 | 重点学习内容 |
|---|---|---|---|
| Tier 0 | Multica | `reference/multica/` | 产品形态、前端观感、运行生命周期、包边界 |
| Tier 0 | OpenAI Codex | `reference/codex/` | 本地 agent loop、app-server、worktree、审批、diff |
| Tier 0 | Claude Code source | `reference/claude-code-source/` | Claude Code 行为、权限、hook、工具调用 |
| Tier 1 | AionUi | `reference/aionui/` | Cowork 平台、ACP 协议、多 Agent Team、Cron、扩展系统 |
| Tier 1 | CloudCLI / claudecodeui | `reference/claudecodeui/` | Claude Code Web UI、移动端适配、Git Explorer |
| Tier 1 | OpenCode | `reference/opencode/` | 多 provider、插件、hook、TUI/SDK 分层 |
| Tier 1 | OpenHands | `reference/OpenHands/` | sandbox、workspace、agent protocol、GUI/CLI/SDK |
| Tier 1 | Opcode | `reference/opcode/` | Tauri 2 桌面端、checkpoint、diff viewer |

## 参考清单

| 仓库 | 路径 | 用途 |
|---|---|---|
| aionui | `reference/aionui/` | Cowork 平台、Team Mode、ACP 协议、Cron、Extension |
| aider | `reference/aider/` | 代码修改、patch、命令行 agent 参考 |
| ChatDev | `reference/ChatDev/` | 多角色协作和 workflow 参考 |
| claude-code-source | `reference/claude-code-source/` | Claude Code 行为和权限参考 |
| claude-code-viewer | `reference/claude-code-viewer/` | 会话历史、Diff、PWA 查看器 |
| claude-code-webui | `reference/claude-code-webui/` | 轻量 Web UI 和实时输出 |
| claudecodeui | `reference/claudecodeui/` | Claude Code Web UI、移动端和 Git 面板 |
| cline | `reference/cline/` | IDE agent、工具审批、文件编辑参考 |
| codex | `reference/codex/` | Codex CLI / app-server / agent loop |
| continue | `reference/continue/` | IDE assistant、上下文和模型配置 |
| crush | `reference/crush/` | Go/TUI agent command center 参考 |
| dify | `reference/dify/` | workflow、tool provider、产品级控制台 |
| docs | `reference/docs/` | 单独补充资料 |
| eca | `reference/eca/` | 编辑器内 coding agent 参考 |
| emdash | `reference/emdash/` | agent command center 竞品参考 |
| Flowise | `reference/Flowise/` | 低代码 agent flow 和节点编排 |
| goose | `reference/goose/` | 本地 agent、扩展和桌面体验参考 |
| jean | `reference/jean/` | 个人 assistant / agent workspace 参考 |
| kanna | `reference/kanna/` | provider catalog、EventStore、session replay |
| langflow | `reference/langflow/` | 可视化编排、flow-as-API、MCP |
| LibreChat | `reference/LibreChat/` | 多模型 IM、artifact、subagent |
| multica | `reference/multica/` | Tier 0 产品和前端参考 |
| opcode | `reference/opcode/` | 桌面 GUI、checkpoint、diff |
| opencode | `reference/opencode/` | provider、hook、插件、SDK |
| OpenHands | `reference/OpenHands/` | sandbox、workspace、agent protocol |
| orca | `reference/orca/` | agent command center 竞品参考 |
| picoclaw | `reference/picoclaw/` | 轻量 agent / CLI 参考 |
| Roo-Code | `reference/Roo-Code/` | VS Code agent、模式、审批、工具调用 |
| ruflo | `reference/ruflo/` | agent command center 竞品参考 |

## 对应报告

- 单仓库报告：`docs/reference/01-learn/repos/`
- 源码深挖：`docs/reference/01-learn/deep-dive/`
- 竞品格局：`docs/reference/01-learn/web-research/`
- 选型比较：`docs/reference/02-decide/`
- 工程规格：`docs/reference/03-build/`

新增 clone 后，先补本索引，再补 `docs/reference/README.md` 中的阅读路线。

## 初始化脚本

参考仓库默认不随 AgentHub 一起提交。新成员需要本地参考源码时运行：

```powershell
.\scripts\setup.ps1 -Reference core
```

`core` 只克隆最常用参考；需要完整调研源码时运行：

```powershell
.\scripts\sync-reference.ps1 -Tier all
```

脚本只同步公开 GitHub 仓库。`reference/claude-code-source/`、`reference/docs/` 这类本机手动资料可以保留在本地，但不能依赖它们作为团队开发的唯一资料源；关键结论要写回 `docs/reference/` 或三份主文档。
