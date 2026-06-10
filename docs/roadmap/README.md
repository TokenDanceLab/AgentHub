# AgentHub 冲刺总路线图

> 最后更新：2026-06-10 · 基于 7 份子文档 + 5 份审计 + `bytedance.md` 逐条对照 + 当前 HEAD `937138a3`
>
> 本文是全部 8 份 Roadmap 文件的入口和总调度表。子文档聚焦细节，本文聚焦优先级和执行编排。

---

## 0. 当前基线

| 维度 | 状态 |
|------|------|
| 提交 | 37 commits · 199 files · 24,816+ insertions |
| HEAD | `937138a3` on `dev/delicious233` |
| Hub | :8080 ✅ (49 migrations, PostgreSQL + Redis) |
| Edge | :3210 ✅ (6 adapters: Claude Code + Codex + OpenCode + Anthropic SDK + OpenAI SDK + Orchestrator) |
| cc-switch | 代理活跃 :15721，opus→deepseek-v4-pro · sonnet→glm-5.1 |
| API keys | `~/.config/local-secrets/` gitignored |
| Go build | PASS |
| TypeScript | PASS (shared) |
| 审计 | Hub 61 端点 / Edge 45+ 端点 / 前端 8 组件 / 后端 6 adapter / 安全 / 性能 |
| RK 子文档 | 8 份 · 42 项 (38 P0 + 2 P1 + 2 P2) |

## 1. 架构（不动的东西）

```
┌─────────────────────────────────────────────────────────┐
│  Web (:5174)  │  Desktop (:5173)  │  Mobile (Expo RN)  │
│  app/web/     │  app/desktop/     │  app/mobile-rn/    │
└──────┬────────┴────────┬──────────┴────────┬───────────┘
       │                 │                   │
       └────────┬────────┴───────────────────┘
                │
    app/shared/ (共享 UI + transcript + composer + inspector)
                │
    ┌───────────┴───────────┐
    │                       │
  Hub (:8080)          Edge (:3210)
  ├─ OIDC/PKCE         ├─ Run lifecycle
  ├─ IM/Chat           ├─ 6 AgentAdapter
  ├─ Contacts/Teams    ├─ SQLite EventStore
  ├─ Skills/MCP Market ├─ cc-switch 读取
  ├─ Agent Profiles    ├─ .agenthub/memory/
  ├─ Documents         ├─ Diff apply
  ├─ Attachments       └─ Surfacing detect
  ├─ Settings
  ├─ PostgreSQL
  └─ Redis

Runtime: Claude Code / Codex / OpenCode / SDK HTTP
         ↓
    cc-switch proxy (:15721) → 透明映射 → DeepSeek/GLM
```

**绝对不动**：GlobalRail · TranscriptView · Composer 主结构。只改右侧 Inspector 和管线层。

---

## 2. 冲刺总表（38 项 · 4 波 · 4-6 小时）

### 🔴 Wave 0 — 基线验证 (立即 · 单人串行)

| # | 任务 | 验收标准 | 预计 |
|---|------|----------|------|
| W0-1 | **E2E 冒烟重跑** | `verify-real-api-smoke.ps1` 13 phase 全部 PASS | 20m |
| W0-2 | **@Agent 真实 Claude Code E2E** | Web OIDC 登录 → 群聊 @Agent → 真实 CLI spawn → transcript 渲染 | 30m |
| W0-3 | **OIDC 登录重验证** | TokenDance ID → Hub callback → JWT → WS auth.ok 全链路 | 20m |

**Wave 0 门禁**：3 项全过 → 基线健康，开始并行。

---

### 🔴 Wave 1 — P0 核心数据断点 (8 路并行)

| # | 任务 | 类型 | 验收标准 | 预计 |
|---|------|------|----------|------|
| W1-1 | **消息回复 + 引用 + 重新生成** | 轻UI | 长按→回复模式→引文缩进渲染；选中→引用→blockquote；长按→重新生成→新回复流式替换旧 | 60m |
| W1-2 | **图片 + 文件附件** | 轻UI | Composer 📎按钮→选图→上传Hub→消息气泡内嵌缩略图；选文件→上传→文件卡片 | 60m |
| W1-3 | **消息搜索跳转 + 未读清零 + WS 状态指示** | 轻UI | 搜索结果点击→聊天区滚动+高亮；进会话→3s内markRead；StatusBar三色灯 | 45m |
| W1-4 | **StepCard 可视化** | 轻UI | RunStepGroupTranscriptBlock→可折叠步骤卡片→展开看子步骤→完成后自动折叠 | 90m |
| W1-5 | **逐 hunk Diff 交互 + 消息重新生成管线** | 轻UI+管线 | Diff卡片 accept/reject→applyHunks→文件真实变更；Hub re-trigger API→流式替换 | 90m |
| W1-6 | **demo 数据 + 技能市场/MCP市场验证 + Agent能力标签** | 数据+验证 | Edge seed数据可用；技能8+MCP6真实展示；联系人列表Agent旁彩色标签 | 45m |
| W1-7 | **cc-switch 别名显示 + Tauri Desktop 编译** | 管线+打包 | Agent配置选模型显示真实别名(opus→deepseek-v4-pro)；Tauri最新代码编译通过 | 75m |
| W1-8 | **Orchestrator 增强端到端验证** | 验证 | 失败降级3次重试→LLM决策→replan；同级上下文注入prompt；Plan确认门 WS 闭环 | 45m |

**Wave 1 总计**：8 项并行 · ~90 分钟（最慢项）

---

### 🟡 Wave 2 — P1 增强 (5 路并行)

| # | 任务 | 类型 | 验收标准 | 预计 |
|---|------|------|----------|------|
| W2-1 | **i18n 完整国际化** | 工程 | 合并 `feat/i18n-shared-workbench` worktree → 补齐所有缺失翻译 → `pnpm typecheck` PASS | 90m |
| W2-2 | **settings 页接线 + Agent 配置子页完善** | 管线+UI | settings三层回退验证(Edge→Hub→localStorage)；Agent配置:Runtime选择+provider/model+MCP/skill绑定 | 90m |
| W2-3 | **通讯录增强 + 云文档 CRUD** | UI+管线 | 加好友队列/接受拒绝/删除；文档列表+创建+读写验证 | 90m |
| W2-4 | **项目管理页** | UI+管线 | 项目列表+创建+workspace绑定+成员 | 60m |
| W2-5 | **Hub bug修复 + Mobile RN 验证 + Android APK 构建** | 管线+验证 | reaction emoji修复验证；登出幂等200；私密会话创建参数对齐；Mobile 91 tests PASS + 真实Hub数据验证；Android APK产出 | 60m |

**Wave 2 总计**：5 项并行 · ~90 分钟

---

### 🔵 Wave 3 — P2 部署 + 演示 + 收口 (4 路并行)

| # | 任务 | 类型 | 验收标准 | 预计 |
|---|------|------|----------|------|
| W3-1 | **hk2 服务器部署 + E2E 验证** | 部署 | docker-compose up → nginx+SSL → Hub/Edge健康 → 远程WS+OIDC全链路 | 90m |
| W3-2 | **文档 + 安全 + 仓库扫描** | 维护 | BYTEDANCE.md+STATE.md最终更新；gitleaks全仓库扫描零泄露；过时文档归档 | 60m |
| W3-3 | **Release Gate 全部脚本通过** | 验证 | CI + API smoke + approved-real gold path + OIDC + release gate 全部 PASS | 45m |
| W3-4 | **演示材料**（需你操作） | 演示 | 3 场景演示视频 (IM@Agent/多Agent编排/产物预览) + 5张截图 (Desktop/Web/产物/审批/DAG) + AI协作证据包 | 90m |

**Wave 3 总计**：4 项并行 · ~90 分钟

---

## 3. 并行 Agent 派遣矩阵

```
Wave 1 (8 agents):
  Agent A → W1-1 (消息回复/引用/重新生成)         [轻UI · app/shared · 60m]
  Agent B → W1-2 (图片+文件附件)                  [轻UI · app/shared+composer · 60m]
  Agent C → W1-3 (搜索跳转+未读+WS状态)            [轻UI · app/shared · 45m]
  Agent D → W1-4 (StepCard)                       [轻UI · transcript渲染 · 90m]
  Agent E → W1-5 (Diff交互+重新生成管线)            [轻UI+管线 · diff.ts+hub handler · 90m]
  Agent F → W1-6 (demo数据+市场验证+能力标签)       [验证 · Edge seed+UI · 45m]
  Agent G → W1-7 (cc-switch别名+Tauri编译)         [管线+打包 · edge+tauri · 75m]
  Agent H → W1-8 (Orchestrator端到端验证)          [验证 · edge adapter · 45m]

Wave 2 (5 agents):
  Agent I → W2-1 (i18n)                            [工程 · feat/i18n worktree · 90m]
  Agent J → W2-2 (settings+Agent配置)               [管线+UI · settings+agent page · 90m]
  Agent K → W2-3 (通讯录+云文档)                    [UI+管线 · contacts+documents · 90m]
  Agent L → W2-4 (项目管理页)                       [UI+管线 · projects page · 60m]
  Agent M → W2-5 (Hub修复+Mobile+APK)               [管线+验证 · hub+mobile-rn · 60m]

Wave 3 (4 agents):
  Agent N → W3-1 (hk2部署)                         [部署 · hk2 · 90m]
  Agent O → W3-2 (文档+安全)                        [维护 · docs+.gitignore · 60m]
  Agent P → W3-3 (Gate脚本)                        [验证 · tests/scripts · 45m]
  你      → W3-4 (演示材料)                         [演示 · 录屏截图]
```

## 4. 工具体系

| 工具 | 用途 |
|------|------|
| `opencode` CLI | 本地可用 · 多 provider |
| `codex` CLI | 本地可用 v0.133.0 · 需要 OPENAI_API_KEY |
| cc-switch proxy | :15721 · 透明映射 Anthropic→第三方 |
| api.vectorcontrol.tech/v1 | 支持 Anthropic + OpenAI 双格式 |
| Docker PostgreSQL | `agenthub-postgres` |
| Docker Redis | `agenthub-redis` |
| TokenDance ID | :3000 · OIDC Provider |

## 5. 验收门（全部通过 = 发布就绪）

```
✅ verify-real-api-smoke.ps1 13 phase 全部 PASS
✅ @Agent 真实 Claude Code CLI spawn + transcript 渲染
✅ OIDC PKCE 登录 → JWT → WS auth.ok 全链路
✅ IM 消息回复/引用/图片附件/重新生成 可用
✅ 文件预览 10 种格式全部可渲染
✅ Skill 8 + MCP 6 市场真实数据展示
✅ cc-switch 模型别名在 Agent 配置可选
✅ cc-switch provider/model 联动读取
✅ Orchestrator 失败降级 + 同级上下文 + Plan确认门 验证通过
✅ Tauri Desktop 最新代码编译通过
✅ Android APK 构建产出
✅ hk2 部署 Hub + Edge 远程可访问
✅ 仓库无密钥泄露
✅ BYTEDANCE.md + STATE.md 反映全部最新状态
✅ Release Gate 全部脚本通过
✅ 3 支演示视频 + 5 张截图 + AI 协作证据包
```

## 6. 不做

| 不做 | 原因 |
|------|------|
| 对话式创建 Agent | 需要新聊天交互流，下版本 |
| 力导向 DAG 图 | `<ul>` 树已够用 |
| macOS 签名/公证 | 缺硬件 |
| 部署闭环 UI / 模型预算面板 | 需要新 settings 页，下版本 |
| 改 Composer 主结构 | ADR-001 |

---

## 7. 子文档索引

| 文档 | 内容 | 项数 |
|------|------|------|
| [00 状态与缺口](00-state.md) | 现有资产 · gap 清单 · 竞品威胁基线 | — |
| [01 管线类](01-pipeline.md) | 后端/合同层 12 项 | 12 |
| [02 轻 UI 接线](02-light-ui.md) | 复用组件 + 少量 CSS 13 项 | 13 |
| [03 右侧栏增强](03-right-panel.md) | Inspector 内容增强 14 项 | 14 |
| [04 竞品优先级](04-competition-gap.md) | 竞品驱动优先级 · 不补清单 | — |
| [05 Release Gate](05-release-gates.md) | 验收标准 · 全门禁 · checkbox | — |
| [06 Orchestrator](06-orchestrator-enhancement.md) | 失败降级 · 同级上下文 · Plan确认 · DAG · 压缩 | 7 |
| [07 bytedance 对照](07-bytedance-gaps.md) | 逐条对照比赛课题要求 | — |

**总计：8 份文档 · 42 项功能 · 16 验收门**
