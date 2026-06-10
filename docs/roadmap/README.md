# AgentHub 冲刺总路线图

> 最后更新：2026-06-10 17:00 · 基于 HEAD `027d00ff`
>
> 已完成项已归档至 [08-completed.md](08-completed.md)。本文只保留未完成项和最新基线。

---

## 0. 当前基线

| 维度 | 状态 |
|------|------|
| 提交 | 8 commits since RC baseline (1995 total · 2108 files · 514k insertions) |
| HEAD | `027d00ff` on `dev/delicious233` |
| Hub | :8080 ✅ (50 migrations, PostgreSQL + Redis) |
| Edge | :3210 ✅ (6 adapters, Claude Code 真实执行已验证) |
| cc-switch | 代理活跃 :15721，opus→deepseek-v4-pro · sonnet→glm-5.1 |
| API keys | `~/.config/local-secrets/` gitignored · key已轮换 |
| Go build | PASS (hub-server + edge-server) |
| TypeScript | ⚠️ 54 errors (核心代码 ~5 处，stories/test 可忽略) |
| hk2 生产 | ✅ Hub Docker + Edge systemd + nginx `/edge/` 反代 + SSL |
| Tauri Desktop | ✅ `AgentHub_0.3.0-rc.7_x64-setup.exe` 14MB |

## 1. 架构（不动的东西）

详见 [00-state.md](00-state.md)。绝对不动：GlobalRail · TranscriptView · Composer 主结构。

---

## 2. 剩余冲刺项（14 项 · 2 波）

### 🔴 Wave 0 — 验证门（需你参与）

| # | 任务 | 验收标准 | 预计 |
|---|------|----------|------|
| W0-1 | **E2E 冒烟重跑** | `verify-real-api-smoke.ps1` 全部 PASS | 20m |
| W0-2 | **@Agent 真实 CC E2E** | Web OIDC 登录 → 群聊 @Agent → Hub→Edge HTTP dispatch → CC CLI → transcript | 30m |
| W0-3 | **OIDC 登录重验证** | TokenDance ID → Hub callback → JWT → WS auth.ok | 20m |

### 🔴 Wave 1 — Agent 负责（已派/待派）

| # | 任务 | 状态 | 预计 |
|---|------|------|------|
| W1-2 | **图片 + 文件附件** | 🔄 Sonnet agent 运行中 | 30m |
| W1-5 | **Diff apply 管线** | 🔄 Sonnet agent 刚派 | 30m |
| W1-6 | **Agent 能力标签** | 🔄 Sonnet agent 刚派 | 15m |
| W1-6 | **demo 数据验证** | ⚠️ Edge SQLite seed 代码已写，未运行验证 | 15m |
| W1-8 | **Orchestrator E2E 验证** | ⚠️ 4 Go 文件已写，需真实 Edge 运行验证 | 30m |
| W2-2 | **Settings + Agent 配置子页** | ❌ 前批agent stalled，需重派 | 45m |
| W2-4 | **项目管理页** | ❌ 需派 agent | 30m |
| W2-5 | **Hub bug 修复** | ⚠️ reaction emoji 已修 · logout/私密会话待修 | 20m |
| W2-5 | **Mobile RN 验证** | ❌ 需验证 | 30m |
| W3-3 | **Release Gate 脚本** | ❌ 4 个 gate 脚本待跑 | 45m |
| W3-4 | **演示材料** | ❌ 3 视频 + 5 截图 — **需你操作** | 90m |
| DEEP | **一键静态部署全栈** | 🔄 Opus agent 运行中（DNS + nginx + 前端 DeployCard） | 60m |
| DEEP | **Orchestrator 运行验证** | ⚠️ 代码已写，需重启 Edge 验证 | 20m |
| — | **TS 编译错误修复** | ⚠️ 核心 ~5 处错误，agent 运行中 | 15m |

---

## 3. 子文档索引

| 文档 | 内容 |
|------|------|
| [00 状态与缺口](00-state.md) | 现有资产 · gap 清单 |
| [01 管线类](01-pipeline.md) | 后端/合同层 |
| [02 轻 UI 接线](02-light-ui.md) | 复用组件 + 少量 CSS |
| [03 右侧栏增强](03-right-panel.md) | Inspector 内容增强 |
| [04 竞品优先级](04-competition-gap.md) | 竞品驱动优先级 |
| [05 Release Gate](05-release-gates.md) | 验收标准 · checkbox |
| [06 Orchestrator](06-orchestrator-enhancement.md) | 失败降级 · Plan 确认门 |
| [07 bytedance 对照](07-bytedance-gaps.md) | 比赛课题逐条对照 |
| [08 已完成归档](08-completed.md) | ✅ 已完成项存档 |
