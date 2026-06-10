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

---

## 4. 竞品动态（2026-06-10 最终拉取）

> 50+ 仓库已全部拉取。DDL 已过，竞品格局固化。

| 竞品 | 今日变更 | 方向 | 威胁变化 |
|---|---|---|---|
| **doloveplayer** | +3479/-196（29 文件） | 🔴 **Turn 系统**：TurnManager 367 行、TurnBoundary UI、VersionSwitcher、UndoPlaceholder——和我们刚完成的 W1-1 完全对标 | ⬆️ 唯一还在做深度工程的 |
| **metrogg** | +872/-115（19 文件） | Tauri Desktop 248 行、timeline-event-writer 82 行、room 投影测试 | → Desktop 变扎实了 |
| **yjzhang2003/bytesing** | +1508/-99（41 文件） | Electron 桌面 auth IPC 110 行、local-services 123 行、UI styles 275 行、v0.1.0 tag | → Desktop 完整度提升 |
| **TreeX-X** | +2078/-1950（53 文件） | Orchestrator playbook 大修：auto-routing 291 行、workflow-state schema、ANALYSIS.md | → 参考线，非直接竞品 |
| **jk-z-z-z** | +2758/-896（41 文件） | 6 个 AI 协作 skills、产品/技术文档、dev rules/spec | → 文档收口 |

**已冻结**：GuqierMcl（仅版本号）、Queena1021、DDJH44（仅 logo 改名）、SeiyunSky、MasterOfAgents、Shallow-W、Toufumind、LancherM、Evan0571、IAyousa 等 40+

### 关键判断

1. **开发窗口彻底关闭**。除了 doloveplayer 的 Turn 系统，所有竞品今天都在做文档/清理/版本号，没有任何新功能。
2. **doloveplayer 的 Turn 系统**直接对标我们刚完成的 W1-1（消息回复/引用/重新生成）。他们用了 367 行 TurnManager + TurnBoundary UI + VersionSwitcher，工程量大。但我们的实现是 60 分钟轻 UI 接线——说明 Hub message API 基础好。
3. **metrogg 的 Desktop 在追**，248 行 Tauri lib.rs 新增。但我们 72 Rust 文件 vs 他们 ~10 文件——差距仍然巨大。
4. **bytedance.md 对照**：所有非 P2 的需求已进入 01-06 子文档。07 已全部归口。剩余缺失：① 对话式创建 Agent（下版本）② P2 部署/版本历史（下版本）③ 演示视频（需你操作）。

## 5. 建议

### 现在该做什么

剩余 4 项全是**验证 + 收口**，不是新功能：

- **W0-1/2/3**：E2E 冒烟 + @Agent 真实 CC + OIDC 登录。这 3 项必须你操作（跑 PS1 脚本、浏览器完成 PKCE、打真实 CLI）。
- **W1-8**：Orchestrator 增强代码已写好（4 Go 文件），Sonnet agent 正在跑 Edge 验证。通过后关闭。
- **W3-3**：Release gate 脚本。代码就绪后 agent 可以跑，但真实 API smoke 需要你配合。
- **W3-4**：录 3-5 支视频 + 5-7 张截图。SeiyunSky 有 7 支视频碾压我们——这个差距需要你补。

### 不建议再做的

- ❌ 不要再加新功能。38/42 项 P0 已完成，剩下的全是验证。
- ❌ 不要再改 UI。右侧栏 13/13 格式、StepCard、streaming bar 都已完成。
- ❌ 不要再审计竞品。窗口关了，doloveplayer 的 Turn 系统是唯一值得看的，已经记录了。
