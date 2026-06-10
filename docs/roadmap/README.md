# AgentHub 冲刺总路线图

> 最后更新：2026-06-10 · HEAD `3f1fa751` · 14 commits today
>
> 已完成项已归档至 [06-completed.md](06-completed.md)。本文只保留未完成项。

---

## 0. 当前基线

| 维度 | 状态 |
|------|------|
| HEAD | `3f1fa751` on `dev/delicious233` |
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
| [04 Release Gate](04-release-gates.md) | 验收标准 · checkbox |
| [05 Orchestrator](05-orchestrator-enhancement.md) | 失败降级 · Plan 确认门 |
| [06 已完成归档](06-completed.md) | ✅ 全部 Wave 1-3 已完成项 |

---

## 5. 建议

### 现在该做什么

剩余 4 项全是**验证 + 收口**，不是新功能：

- **W0-1/2/3**：E2E 冒烟 + @Agent 真实 CC + OIDC 登录。这 3 项必须你操作（跑 PS1 脚本、浏览器完成 PKCE、打真实 CLI）。
- **W1-8**：Orchestrator 增强代码已写好（4 Go 文件），Sonnet agent 正在跑 Edge 验证。通过后关闭。
- **W3-3**：Release gate 脚本。代码就绪后 agent 可以跑，但真实 API smoke 需要你配合。
- **W3-4**：录 3-5 支视频 + 5-7 张截图。演示材料差距需要你补。

### 不建议再做的

- ❌ 不要再加新功能。38/42 项 P0 已完成，剩下的全是验证。
- ❌ 不要再改 UI。右侧栏 13/13 格式、StepCard、streaming bar 都已完成。
- ❌ 不要再审计竞品。竞品格局已固化。
