# AgentHub 冲刺总路线图

> 最后更新：2026-06-10 17:45 · HEAD `e242a341` · 14 commits today
>
> 已完成项已归档至 [08-completed.md](08-completed.md)。本文只保留未完成项。

---

## 0. 当前基线

| 维度 | 状态 |
|------|------|
| HEAD | `e242a341` on `dev/delicious233` |
| 今日提交 | 14 commits · 30+ files changed |
| Hub | :8080 ✅ · 50 migrations · PostgreSQL + Redis · Hub→Edge HTTP dispatch 已通 |
| Edge | :3210 ✅ · 6 adapters · Claude Code 真实执行已验证 · demo seed 11 threads |
| cc-switch | :15721 · opus→deepseek-v4-pro · sonnet→glm-5.1 |
| hk2 生产 | ✅ Hub Docker + Edge systemd + nginx SSL + `/edge/` 反代 |
| Tauri Desktop | ✅ `AgentHub_0.3.0-rc.7_x64-setup.exe` 14MB |
| Mobile RN | ✅ 91 tests PASS · Hub 连接正确 |
| Go build | ✅ hub-server + edge-server |
| TypeScript | ✅ 核心代码零错误 |
| API key | ✅ 已轮换 · `~/.config/local-secrets/` gitignored |

---

## 2. 剩余缺口（4 项）

### 🔴 Wave 0 — 验证门（需你参与）

| # | 任务 | 状态 |
|---|------|------|
| W0-1 | **E2E 冒烟** — `verify-real-api-smoke.ps1` 全部 PASS | ❌ 待跑 |
| W0-2 | **@Agent 真实 CC E2E** — Web OIDC → 群聊 @Agent → dispatch → CC CLI → transcript | ⚠️ 各环节独立验证通过，全链路待跑 |
| W0-3 | **OIDC 登录** — TokenDance ID → Hub → JWT → WS | ⚠️ 之前通过，待重验 |

### 🔴 Agent 负责

| # | 任务 | 状态 |
|---|------|------|
| W1-8 | **Orchestrator E2E 验证** — 4 Go 文件已写，需真实 Edge 运行验证 | 🔄 Sonnet 运行中 |
| W3-3 | **Release Gate 脚本** — 4 个 gate 脚本全 PASS | ❌ 待跑 |
| W3-4 | **演示材料** — 3 视频 + 5 截图 | ❌ 需你操作 |
| DEEP | **一键部署 DNS** — `*.pages.vectorcontrol.tech` DNS记录 | 🔄 Sonnet 运行中 |
| DEEP | **一键部署全链路** — DNS→nginx→SCP→公网访问 端到端 | 🔄 待 DNS 完成后验证 |

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
| [08 已完成归档](08-completed.md) | ✅ 全部 Wave 1-3 已完成项 |
