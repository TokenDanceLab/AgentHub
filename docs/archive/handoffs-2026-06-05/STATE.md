# AgentHub 项目状态

最后更新：2026-06-06 | 分支：`dev/delicious233`

> 旧版完整历史归档：[archive/handoffs/STATE-full-history-20260605.md](../archive/handoffs/STATE-full-history-20260605.md)

## 构建状态

| 组件 | TypeScript | 测试 | Go |
|------|:----------:|:----:|:--:|
| Desktop | 0 error | 1166/1166 | — |
| Web | 0 error | ~16 files | — |
| Mobile | 0 error | 27/27 | — |
| Edge Server | — | — | 17/17 包 ✅ |
| Hub Server | — | — | 17/17 包 ✅ |

## 技术栈

```
Desktop (React 19 + Tauri) → Edge Server (Go, :3210) → CLI Agents
                           → Hub Server (Go, :8080) → PostgreSQL + Redis
```

| 端口 | 服务 |
|------|------|
| 5173 | Desktop Vite dev |
| 5174 | Mobile Vite dev |
| 3210 | Edge Server (本地) |
| 8080 | Hub Server (本地) / 8090 (生产) |

## 本地开发

```bash
# Edge Server
cd edge-server && go build -o agenthub-edge.exe ./cmd/agenthub-edge && ./agenthub-edge.exe --store-file test_store.json

# Desktop
cd app/desktop && pnpm tauri dev

# Hub Server — 不需要本地跑，Desktop 直连生产 https://api.hub.vectorcontrol.tech
```

### 测试命令

```bash
# Go 后端
cd edge-server && go test ./... -short -race -count=1
cd hub-server && go test ./... -short -race -count=1

# Desktop 前端
cd app/desktop && pnpm typecheck && pnpm test:ci

# Web 前端
cd app/web && corepack.cmd pnpm typecheck && corepack.cmd pnpm exec vite build
```

## 生产部署

| 服务 | URL |
|------|-----|
| 官网 | https://hub.vectorcontrol.tech |
| Hub API | https://api.hub.vectorcontrol.tech (nginx:443 → Docker :8090) |

部署方式：本机构建 → `docker save` → scp → `docker load` → `docker compose up -d --no-build --force-recreate hub-server`

> 服务器别名（hk1、hk2、us1、gz1）不得出现在仓库文件中。运维详情见 `C:\Users\Ding\server\STATE.md`。

## Subagent 规则

当前只允许 Codex 自带 subagent：`gpt-5.5` + `xhigh`。

- **主 Agent**: 架构决策、分支治理、审查、核心文件编辑、roadmap 更新。
- **Codex GPT-5.5 xhigh subagent**: 核心实现、后端/Edge/Hub 切片、文档治理、关键 code review。
- 每次派工必须写清允许路径、禁止范围、验收命令和证据输出。
- 暂不使用 Claude CLI subagent；如后续重新启用，先同步 AGENTS/dev-loop/roadmap。

## 已知阻塞

- 3 个 Dependabot moderate 漏洞（vendor 依赖）
- Mobile OIDC 深链 Rust stub
- 无 Firefox/WebKit Playwright

## 2026-06-05 Codex 规划审核

- `docs/roadmap.md` 已新增"比赛冲刺覆盖层"：比赛前优先级改为 IM 多 Agent 可演示闭环、IM 富消息投影、真实 TeamRun E2E transcript、生成效果证据。
- C0/C1 比赛最小闭环不再等待 B0 Edge SQLite/FTS5 完成；B0 仍是稳定性加分项，不是 @Agent 群聊和 TeamRun transcript 的入场门槛。
- 当前并行 worktree 边界：`phase-a4/thread-nav` 改 A4 thread navigation，`phase-a6/envelope` 改 Edge success envelope，`phase-fe/blockkey-stable` 改 block key。后续 agent 不要重复开同路径任务，主线只做验收/合并/测试。
- 当前代码核对：主 `PromptInput` 已有 @mention；IM 的 `IMMessageInput` 仍是纯 textarea，`IMMessageView` 仍只渲染 Markdown。这是比赛 30% AI 协作与 20% 生成效果的最高优先缺口。

## 2026-06-06 Codex 后端/治理推进

- README/README_EN 已清理为专业项目入口：移除未成品截图占位、竞品踩踏表、失效英文链接和“已完成式”状态叙事。
- Subagent 规则已收敛：当前只允许 Codex 自带 `gpt-5.5` + `xhigh`，同步到 AGENTS、dev-loop、STATE、roadmap。
- Edge/API 已补 TeamRun context 接收链路：`POST /v1/runs` 接收 `teamId`、`teamRunId`、`teamMemberId`、`teamMemberRole`，写入 `RunProcessContext`，并透传到 adapter context；OpenAPI `StartRunRequest` 已同步。
- 剩余 TeamRun E2E blocker：Desktop bridge `useHubIntegration.ts` 仍需把 Hub `agent.dispatch` payload 的 team fields 转发给 Edge；真实双 Runtime E2E、事件导出和录屏仍未完成。
