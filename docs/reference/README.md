# AgentHub 参考项目调研文档

> 25 个参考项目，按问题域检索。Agent 路径：**按需求查找 → 直接进入相关文档**。

---

## 按问题找

```
想看全貌 → cross-comparison/00-synthesis.md
想看最佳实践 → cross-comparison/10-best-practices-playbook.md
想看多 Agent 聚合/委派/git worktree/IM 通道 → projects/codeg/
想做架构判断/ADR/RAG Memory/权限双轴 → cross-comparison/12-awesome-architecture-study.md
想看产品方向/长期路线 → cross-comparison/14-product-direction-competitive-roadmap.md
想做 UI → projects/multica/ · projects/opencode/ · projects/lobehub/ · projects/cherry-studio/
想做安全 → projects/claude-code-sdk/ · cross-comparison/07-permission-models.md
想做适配器 → cross-comparison/01-adapters.md · projects/aionui/
想做编排 → cross-comparison/03-orchestration.md · cross-comparison/13-agentteam-competitive-roadmap.md · projects/aionui/ · projects/codeg/
想做沙箱 → cross-comparison/04-sandbox-tools.md · projects/aionui/
想做撤销 → cross-comparison/05-undo-rollback.md
想做实时同步 → cross-comparison/06-realtime-sync.md
想做 Prompt → cross-comparison/09-prompt-engineering.md
想做 UI 美化 → cross-comparison/08-ui-beautify-plan.md · projects/aionui/09-ui-deep-comparison.md · projects/cherry-studio/02-ui-and-source-patterns.md
想做搜索 → projects/claude-code-viewer/
想做桌面 Shell → projects/opcode/ + projects/cloudcli/ · projects/cherry-studio/
想做 Agent 市场 → projects/lobehub/
想做消息/IM → projects/librechat/ · projects/codeg/ · cross-comparison/02-im-ux.md
想做 worktree/diff → projects/claude-code-viewer/ · projects/codeg/
想做 Team/多Agent → cross-comparison/13-agentteam-competitive-roadmap.md · projects/aionui/ · projects/lobehub/ · projects/codeg/
想做 Agent 自动发现 → projects/aionui/
想做 Cron 自动化 → projects/aionui/
想做审批分级 → projects/aionui/
想做 Agent Runtime / Claude Code SDK / Channel → projects/cherry-studio/03-agent-runtime-lessons.md
想做 typed blocks / composer scopes / artifact preview → projects/cherry-studio/02-ui-and-source-patterns.md
想做 OpenAI Apps/daemon/MCP/skills 架构 → projects/open-design/
```

---

## 文档结构

### projects/ -- 25 个参考项目

`ai-coding-tools/` · `aionui/` · `cc-switch/` · `chatdev/` · `cherry-studio/` · `claude-code-sdk/` · `claude-code-source/` · `claude-code-viewer/` · `claude-code-webui/` · `cloudcli/` · `codeg/` · `codex-cli/` · `command-centers/` · `dify/` · `goose/` · `kanna/` · `langflow-flowise/` · `librechat/` · `lobehub/` · `mindfs/` · `multica/` · `opcode/` · `open-design/` · `opencode/` · `openhands/`

每个项目目录包含该项目的 overview、架构分析、可采纳模式等。

### cross-comparison/ -- 跨项目对比研究（16 篇）

`00-synthesis.md`（总报告） · `01-adapters.md` · `02-im-ux.md` · `03-orchestration.md` · `04-sandbox-tools.md` · `05-undo-rollback.md` · `06-realtime-sync.md` · `07-permission-models.md` · `08-ui-beautify-plan.md` · `09-prompt-engineering.md` · `10-best-practices-playbook.md` · `11-bytedance-feature-map.md` · `12-awesome-architecture-study.md` · `13-agentteam-competitive-roadmap.md` · `14-product-direction-competitive-roadmap.md` · `15-competitive-update-2026-05-27.md`

### web-research/ -- 生态调研

`01-tech-stack.md` · `03-claude-agent-sdk.md` · `04-agent-command-center-2026.md`

### planning/ -- 规划排期

`01-research-to-implementation.md` · `02-claude-sdk-impact.md`

### 独立研究

- `docs/research/research-synthesis.md` -- 研究综合报告
- `docs/archive/desktop-infinite-render-fix.md` -- Desktop 无限渲染修复记录
