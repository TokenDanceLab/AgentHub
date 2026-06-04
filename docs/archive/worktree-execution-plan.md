# AgentHub Worktree 并行执行计划

> 基于 `quality-convergence.md` 审计结果
> 最后更新：2026-06-03 | 基线分支：`dev/delicious233`

---

## 1. 冲突域分析

每个 worktree 只能修改自己冲突域内的文件。共享同一冲突域的 work item 必须串行合并。

```
┌─────────────────────────────────────────────────────────────────────┐
│                        冲突域拓扑                                    │
│                                                                     │
│  [Web-pages]          [ChatView+IM]        [SettingsPage]           │
│  GroupWorkspace.tsx   ChatView.tsx         SettingsPage.tsx         │
│  PrivateChats.tsx     ChatView.types.ts    SettingsPage.module.css  │
│  Project.tsx          IM/*.tsx             sections/*.tsx           │
│  AgentSquare.tsx      IM/*.module.css      cards/*.tsx              │
│                       ApprovalCard.tsx                              │
│                                                                     │
│  [CSS-tokens]         [i18n]               [Backend]                │
│  desktop/styles/*     desktop/i18n/*       edge-server/*            │
│  web/styles/*         web/i18n/*           hub-server/*             │
│                       shared components    api/*                    │
│                                                                     │
│  [Engineering]                                                      │
│  .gitignore, Makefile, CI, test configs                             │
└─────────────────────────────────────────────────────────────────────┘
```

**规则**：不同冲突域的 worktree 可以并行。同域内的工作必须按顺序合并（前一个 merge 后才能开下一个 worktree）。

---

## 2. 并行波次总览

```
时间线 ──────────────────────────────────────────────────────►

Wave 1（5 路并行，互不冲突）:
  WT-A  │ web-mock-cleanup          │ Web-pages      │
  WT-B  │ chat-stub-fixes           │ ChatView+IM    │
  WT-C  │ settings-extraction       │ SettingsPage   │
  WT-D  │ glass-tokens              │ CSS-tokens     │
  WT-E  │ git-hygiene + backend     │ Engineering    │

          ↓ WT-A merge              ↓ WT-B merge      ↓ WT-C merge
Wave 2（5 路并行）:
  WT-A2 │ web-tests                 │ Web-pages      │
  WT-B2 │ im-css-modular            │ ChatView+IM    │
  WT-C2 │ settings-css-split        │ SettingsPage   │
  WT-D2 │ web-light-theme           │ CSS-tokens-web │
  WT-E2 │ i18n-cleanup              │ i18n           │

          ↓ WT-C2 merge
Wave 3（按需）:
  WT-C3 │ settings-i18n             │ SettingsPage+i18n │
  WT-F  │ backend-changelog         │ Backend          │
  WT-G  │ visual-regression-tests   │ Engineering      │
```

---

## 3. Wave 1 — 五路并行

### WT-A: `feat/web-mock-cleanup`

**目标**：消灭 Web 端所有 mock 数据页面。

**前置条件**：无。基于 `dev/delicious233`。

**文件清单**：
| 操作 | 文件 | 说明 |
|------|------|------|
| MODIFY | `app/web/src/pages/GroupWorkspace.tsx` | 删除 `mockMembers`/`mockTasks`，接入 `useAgentTeams`/`useAgentTeamRuns` query；无数据时显示 `<EmptyState>` |
| MODIFY | `app/web/src/pages/PrivateChats.tsx` | 删除 `mockChats`，接入 `useHubSession` 真实数据；修复 `'昨天'` 硬编码中文 |
| MODIFY | `app/web/src/pages/Project.tsx` | 删除 `mockTasks`/`mockMilestones`/`mockRisks`，接入 `useProjectList` query；删除非功能铃铛/齿轮按钮 |
| MODIFY | `app/web/src/pages/AgentSquare.tsx` | 修复 `fetch()` 响应被丢弃的 bug：解析 response 并展示 custom-agents |
| CREATE | `app/web/src/api/teamQueries.ts` | `useAgentTeams`、`useAgentTeamRuns` query hooks（如不存在） |
| MODIFY | `app/web/src/i18n/locales/zh/privateChats.json` | 补全缺失 key |
| MODIFY | `app/web/src/i18n/locales/en/privateChats.json` | 补全缺失 key |

**验收标准**：
- [ ] 四个页面零 `mock` 变量
- [ ] 无 Hub 登录时显示空状态 + 登录引导，不显示假数据
- [ ] 登录后展示真实 Hub 数据
- [ ] `pnpm --filter web build` 通过
- [ ] `pnpm --filter web test` 通过

**合并顺序**：独立，随时可 merge。

---

### WT-B: `feat/chat-stub-fixes`

**目标**：修复 ChatView 和 TeamApprovalPanel 中所有 stub handler 和丢失的上下文数据。

**前置条件**：无。基于 `dev/delicious233`。

**文件清单**：
| 操作 | 文件 | 说明 |
|------|------|------|
| MODIFY | `app/desktop/src/components/ChatView.types.ts` | `approval` block 类型扩展：增加 `agentName`, `toolName`, `riskLevel`, `reason`, `timestamp` 字段 |
| MODIFY | `app/desktop/src/components/ChatView.tsx` | L858: `onApplyDiff` 接入真实 mutation（调用 edge API `POST /v1/items/{id}:apply-diff` 或本地 fs write）；L993-1002: ApprovalCard props 从 block 字段读取而非硬编码 |
| MODIFY | `app/desktop/src/components/IM/TeamApprovalPanel.tsx` | L68-82: `handleApprove`/`handleDeny` 将 `reasonInput` 传给 `onApprove(id, reason)`/`onDeny(id, reason)`；增加确认对话框（Dialog + 二次点击） |
| MODIFY | `app/desktop/src/components/ApprovalCard.tsx` | 如需要：补充 `agentName`/`toolName` 的渲染逻辑 |
| MODIFY | `app/desktop/src/__tests__/ChatView.test.tsx` | 补充 approval block 渲染测试 |

**验收标准**：
- [ ] Artifact 预览的"Apply Diff"按钮点击后有真实效果（或明确 toast 反馈）
- [ ] 审批卡片显示真实 agent 名、工具名、风险级别、时间戳
- [ ] TeamApprovalPanel approve/deny 携带 reason 文本
- [ ] approve/deny 有二次确认对话框
- [ ] `pnpm --filter desktop test` 通过

**合并顺序**：独立，随时可 merge。

---

### WT-C: `feat/settings-extraction`

**目标**：将 SettingsPage.tsx 从 4200 行内联 JSX 重构为 import 已提取的 section 组件。

**前置条件**：无。基于 `dev/delicious233`。这是 SettingsPage 冲突域的第一个 worktree。

**文件清单**：
| 操作 | 文件 | 说明 |
|------|------|------|
| MODIFY | `app/desktop/src/components/SettingsPage.tsx` | 逐 section 替换：删除 `{active === 'xxx' && (...)}` inline block，替换为 `import XxxSection from './settings/sections/XxxSection'` + `{active === 'xxx' && <XxxSection ... />}` |
| MODIFY | `app/desktop/src/components/settings/sections/GeneralSection.tsx` | 对比 inline 版本，补齐缺失功能（如有） |
| MODIFY | `app/desktop/src/components/settings/sections/ConfigurationSection.tsx` | 同上 |
| MODIFY | `app/desktop/src/components/settings/sections/OnlineImSection.tsx` | 同上——这个版本功能更完整，应优先使用 |
| MODIFY | `app/desktop/src/components/settings/sections/KeyboardSection.tsx` | 同上——有完整键盘自定义功能 |
| MODIFY | `app/desktop/src/components/settings/sections/WorktreeSection.tsx` | 同上——有真实工作区选择 |
| MODIFY | `app/desktop/src/components/settings/sections/PermissionsSection.tsx` | 同上——有 AllowlistEditor |
| MODIFY | `app/desktop/src/components/settings/sections/GroupChatSection.tsx` | 同上——有房间列表 |
| MODIFY | `app/desktop/src/components/settings/sections/DataSection.tsx` | 接入导航（inline 版本完全缺失） |
| MODIFY | `app/desktop/src/components/settings/primitives/SelectControl.tsx` | 补齐 `disabled` prop |
| ...其余 ~20 个 section 文件 | 逐个对比 inline vs extracted，保留功能更完整的一方 |
| MODIFY | `app/desktop/src/__tests__/SettingsPage.test.tsx` | 更新 import 路径和测试 |

**执行子步骤**（建议按此顺序逐个 section 替换，每替换 3-5 个跑一次测试）：

1. **低风险 section**（inline 和 extracted 功能等价）：General, Appearance(已 import), Configuration, Personalization, Models, ModelMapping, CcSwitch, ComputerUse, Browser, Account, Archived
2. **高收益 section**（extracted 比 inline 功能更完整）：OnlineIm, Keyboard, Worktree, Permissions, GroupChat, Data
3. **等价替换 section**：AgentProfiles, ExecutionTargets, Tasks, AgentScheduling, AgentMarket, Mcp, Skills, Hooks, RemoteControl, Git, Environment, Platforms, SecurityAudit

**验收标准**：
- [ ] SettingsPage.tsx 行数 ≤ 1500（从 4200 降低）
- [ ] 至少 25 个 section 从 extracted 文件加载
- [ ] DataSection 出现在导航中且可用
- [ ] Online IM 区显示真实 Hub session/contact 数据
- [ ] 键盘快捷键区支持编辑和自定义
- [ ] `pnpm --filter desktop build` 通过
- [ ] `pnpm --filter desktop test` 通过（SettingsPage.test.tsx 全绿）
- [ ] 手动检查：设置页每个 section 能打开、有数据、控件能交互

**合并顺序**：这是 SettingsPage 域的**第一个** worktree。必须在 WT-C2（CSS split）之前 merge。

---

### WT-D: `feat/glass-tokens`

**目标**：定义 glass token 层，替换 Desktop CSS 中 797 个硬编码 `rgba()` 值。

**前置条件**：无。基于 `dev/delicious233`。

**文件清单**：
| 操作 | 文件 | 说明 |
|------|------|------|
| MODIFY | `app/desktop/src/styles/tokens.css` | 新增 glass token 定义：`--glass-bg-subtle: rgba(255,255,255,0.035)`, `--glass-bg-medium: rgba(255,255,255,0.065)`, `--glass-bg-strong: rgba(255,255,255,0.12)`, `--glass-border: rgba(255,255,255,0.08)`, `--glass-tint-plum: rgba(99,102,241,0.12)`, `--glass-tint-moss: rgba(34,197,94,0.10)`, `--glass-tint-danger: rgba(239,68,68,0.10)` 等（~15-20 个 token） |
| MODIFY | `app/desktop/src/styles/themes.css` | `[data-theme='light']` 下添加 light glass 值（方向反转：`rgba(0,0,0,0.03)` 等） |
| MODIFY | `app/desktop/src/components/SettingsPage.module.css` | 批量替换 rgba() → var(--glass-*)（95 个） |
| MODIFY | `app/desktop/src/components/ChatView.module.css` | 同上（91 个） |
| MODIFY | `app/desktop/src/components/PromptInput.module.css` | 同上（69 个） |
| MODIFY | `app/desktop/src/App.module.css` | 同上（106 个） |
| MODIFY | `app/desktop/src/components/WelcomeScreen.module.css` | 同上（47 个） |
| MODIFY | `app/desktop/src/components/ThreadPanel.module.css` | 同上（36 个） |
| MODIFY | 其余 ~25 个 `.module.css` | 同上 |

**验收标准**：
- [ ] tokens.css 有 ≥15 个 glass token 定义，light/dark 双主题
- [ ] 全部 `.module.css` 中 rgba() 数量从 797 降到 ≤100
- [ ] Dark/Light 主题切换后 glass 效果正确跟随
- [ ] `pnpm --filter desktop build` 通过
- [ ] 视觉无回归（截图对比 before/after）

**合并顺序**：独立，随时可 merge。

---

### WT-E: `feat/git-hygiene-backend`

**目标**：清理 git 卫生 + 更新 CHANGELOG + 添加 backend binary 排除规则。

**前置条件**：无。基于 `dev/delicious233`。

**文件清单**：
| 操作 | 文件 | 说明 |
|------|------|------|
| MODIFY | `.gitignore` | 添加 `server-hub-linux`, `server-hub-*`, `cov*.out`, `*.coverprofile` |
| DELETE | `hub-server/server-hub-linux` | 编译产物（如存在） |
| DELETE | `edge-server/cov*.out` | 覆盖率文件（如存在） |
| DELETE | `hub-server/cov*.out` | 覆盖率文件（如存在） |
| MODIFY | `CHANGELOG.md` | 补充 2026-05-28 到 2026-06-03 的变更日志（从 git log 提取） |
| CREATE | `docs/guides/local-dev-setup.md` | Edge + Hub 本地联调指南（docker-compose、环境变量、OIDC 测试） |

**验收标准**：
- [ ] `git status` 无 untracked 编译产物
- [ ] CHANGELOG.md 有 ≥3 个版本条目
- [ ] 本地开发指南覆盖 Edge+Hub 联调全流程
- [ ] `.gitignore` 覆盖所有已知 build artifact 模式

**合并顺序**：独立，随时可 merge。

---

## 4. Wave 2 — Wave 1 合并后启动

### WT-A2: `feat/web-tests`

**冲突域**：Web-pages
**前置**：WT-A merge 后

| 操作 | 文件 |
|------|------|
| CREATE | `app/web/src/__tests__/SettingsPage.test.tsx` |
| CREATE | `app/web/src/__tests__/AgentSquare.test.tsx` |
| CREATE | `app/web/src/__tests__/PrivateChats.test.tsx` |
| CREATE | `app/web/src/__tests__/GroupWorkspace.test.tsx` |
| CREATE | `app/web/src/__tests__/Project.test.tsx` |
| CREATE | `app/web/src/__tests__/IMView.test.tsx` |
| CREATE | `app/web/src/__tests__/ChatView.test.tsx` |

**验收**：Web 包测试文件数 ≥ 10。

---

### WT-B2: `feat/im-css-modular`

**冲突域**：ChatView+IM
**前置**：WT-B merge 后

| 操作 | 文件 |
|------|------|
| CREATE | `app/desktop/src/components/IM/TeamApprovalPanel.module.css` |
| CREATE | `app/desktop/src/components/IM/TeamEventTimeline.module.css` |
| CREATE | `app/desktop/src/components/IM/TeamMemberList.module.css` |
| CREATE | `app/desktop/src/components/IM/TeamTaskBoard.module.css` |
| MODIFY | `app/desktop/src/components/IM/TeamApprovalPanel.tsx` | 全部 inline style → CSS module class |
| MODIFY | `app/desktop/src/components/IM/TeamEventTimeline.tsx` | 同上 |
| MODIFY | `app/desktop/src/components/IM/TeamMemberList.tsx` | 同上 |
| MODIFY | `app/desktop/src/components/IM/TeamTaskBoard.tsx` | 同上 |

**验收**：四个 IM 组件零 inline `style={{}}`，零硬编码 hex 颜色，全部使用 `--td-*` token。

---

### WT-C2: `feat/settings-css-split`

**冲突域**：SettingsPage
**前置**：WT-C merge 后

| 操作 | 文件 |
|------|------|
| CREATE | `app/desktop/src/components/settings/primitives/primitives.module.css` | 从 SettingsPage.module.css 提取 Panel/ModeCard/SummaryCard/CapabilityCard/SettingRow/SelectControl/Switch 样式 |
| CREATE | `app/desktop/src/components/settings/sections/sections-im.module.css` | OnlineIm/GroupChat 相关样式 |
| CREATE | `app/desktop/src/components/settings/sections/sections-agents.module.css` | AgentProfiles/AgentMarket/AgentScheduling 相关样式 |
| CREATE | `app/desktop/src/components/settings/sections/sections-dev.module.css` | Git/Worktree/Hooks/Environment/Mcp/Skills 相关样式 |
| CREATE | `app/desktop/src/components/settings/sections/sections-account.module.css` | Account/SecurityAudit/Platforms 相关样式 |
| MODIFY | `app/desktop/src/components/SettingsPage.module.css` | 只保留页面级布局（sidebar/nav/grid shell），从 2114 行降到 ≤400 行 |
| MODIFY | 各 section 文件 | 更新 CSS import 路径 |

**验收**：SettingsPage.module.css ≤ 400 行；每个 section 有独立 CSS module。

---

### WT-D2: `feat/web-light-theme`

**冲突域**：CSS-tokens-web
**前置**：无（但如果 glass token 模式要对齐 desktop，建议 WT-D merge 后）

| 操作 | 文件 |
|------|------|
| MODIFY | `app/web/src/styles/tokens.css` | 补齐缺失 token（font-size 4 个、font-weight 1 个、z-index 刻度、animation token）；添加 `[data-theme='light']` 完整 light theme |
| CREATE | `app/web/src/styles/themes.css` | 如需要：从 desktop themes.css 同步 6 个 preset 主题 |

**验收**：Web 端 light theme 可用，6 个 preset 主题可切换。

---

### WT-E2: `feat/i18n-cleanup`

**冲突域**：i18n
**前置**：无

| 操作 | 文件 |
|------|------|
| MODIFY | `app/desktop/src/components/IM/IMMessageInput.tsx` | 所有硬编码英文 → `t()` |
| MODIFY | `app/desktop/src/components/IM/IMMessageView.tsx` | `'Just now'`/`'m ago'`/`'No messages yet'` → `t()`；`formatTime` 使用 app locale |
| MODIFY | `app/desktop/src/components/IM/IMView.tsx` | `'Interface gap'` → 用户友好描述；`'IM Chat'` → `t()` |
| MODIFY | `app/desktop/src/components/ChatView.tsx` | L621 `"... more lines"` → `t()` |
| MODIFY | `app/desktop/src/i18n/locales/en.json` | 补充新增 key |
| MODIFY | `app/desktop/src/i18n/locales/zh.json` | 补充新增 key |
| CREATE | `scripts/verify-i18n-keys.mjs` | 双向校验 en.json/zh.json key parity 的 CI 脚本 |
| MODIFY | `app/desktop/src/components/settings/SettingsPage.tsx`（仅 i18n 部分） | `'Online'`/`'Offline'` → `t()`；用户路径 → 动态检测 |

**注意**：如果 WT-C 尚未 merge，此 worktree 不应修改 SettingsPage.tsx。此时仅做 IM 组件和 ChatView 的 i18n 修复，SettingsPage 的 i18n 修复留到 WT-C3。

**验收**：
- [ ] IM 相关组件零硬编码英文/中文
- [ ] `scripts/verify-i18n-keys.mjs` 双向校验通过
- [ ] CI 中集成 i18n parity check

---

## 5. Wave 3 — 按需启动

### WT-C3: `feat/settings-i18n-polish`

**冲突域**：SettingsPage + i18n
**前置**：WT-C + WT-E2 merge 后

| 操作 | 说明 |
|------|------|
| 清理 SettingsPage 中所有残留硬编码字符串 |
| 将 `'Interface gap'`、`'status.interfaceGap'` 等开发占位符替换为用户友好文案 |
| 统一 `interfaceGap`/`loginLocked` 等内部状态标签为面向用户的描述 |

---

### WT-F: `feat/backend-docs`

**冲突域**：Backend
**前置**：无

| 操作 | 文件 |
|------|------|
| CREATE | `docs/guides/agent-team-integration.md` | AgentTeam E2E 集成指南 |
| CREATE | `docs/guides/oidc-browser-test.md` | OIDC 浏览器冒烟测试手册 |
| MODIFY | `docs/governance/security-risk-register.md` | 合并重复的安全文档 |
| DELETE | `docs/governance/security-risk-register.md` | [not executed — governance/ copy is canonical] |

---

### WT-G: `feat/visual-regression-tests`

**冲突域**：Engineering
**前置**：WT-C + WT-D merge 后

| 操作 | 文件 |
|------|------|
| CREATE | `app/desktop/e2e/settings-theme.spec.ts` | Playwright 截图：theme 切换、6 个 preset、dark/light |
| CREATE | `app/desktop/e2e/settings-sections.spec.ts` | Playwright 截图：每个 section 的视觉快照 |
| CREATE | `app/desktop/e2e/chat-view.spec.ts` | Playwright 截图：消息渲染、code block、approval card |
| MODIFY | `app/desktop/e2e/` 配置 | 添加 screenshot comparison baseline |

---

## 6. 并行分配建议

### 如果只有 1 个 Agent（串行）

按优先级顺序：WT-E → WT-A → WT-B → WT-C → WT-D → 其余

### 如果有 2 个 Agent 并行

| Agent 1 | Agent 2 |
|---------|---------|
| WT-C（settings-extraction，最复杂） | WT-A（web-mock-cleanup） |
| WT-C2（settings-css-split） | WT-B（chat-stub-fixes） |
| WT-C3（settings-i18n） | WT-D（glass-tokens） |

### 如果有 3 个 Agent 并行

| Agent 1 | Agent 2 | Agent 3 |
|---------|---------|---------|
| WT-C（settings-extraction） | WT-A + WT-A2（web） | WT-B + WT-B2（chat+IM） |
| WT-C2（settings-css-split） | WT-D（glass-tokens） | WT-E + WT-E2（backend+i18n） |

### 如果有 5 个 Agent 并行（最大并行度）

| Agent 1 | Agent 2 | Agent 3 | Agent 4 | Agent 5 |
|---------|---------|---------|---------|---------|
| WT-C | WT-A | WT-B | WT-D | WT-E |
| ↓ | ↓ | ↓ | ↓ | ↓ |
| WT-C2 | WT-A2 | WT-B2 | WT-D2 | WT-E2 |

---

## 7. Worktree 操作命令

### 创建 worktree

```bash
cd D:\Code\TokenDance\AgentHub

# 每个 worktree 一个命令
git worktree add ../.worktrees/feat-web-mock-cleanup -b feat/web-mock-cleanup dev/delicious233
git worktree add ../.worktrees/feat-chat-stub-fixes -b feat/chat-stub-fixes dev/delicious233
git worktree add ../.worktrees/feat-settings-extraction -b feat/settings-extraction dev/delicious233
git worktree add ../.worktrees/feat-glass-tokens -b feat/glass-tokens dev/delicious233
git worktree add ../.worktrees/feat-git-hygiene -b feat/git-hygiene-backend dev/delicious233
```

### 合并回 dev

```bash
cd D:\Code\TokenDance\AgentHub
git checkout dev/delicious233
git merge --no-ff feat/web-mock-cleanup -m "merge: web mock cleanup"
git merge --no-ff feat/chat-stub-fixes -m "merge: chat stub fixes"
# ... SettingsPage 域必须按顺序：C → C2 → C3
git merge --no-ff feat/settings-extraction -m "merge: settings extraction"
git merge --no-ff feat/glass-tokens -m "merge: glass tokens"
git merge --no-ff feat/git-hygiene-backend -m "merge: git hygiene"
```

### Wave 2 worktree 创建（基于最新 dev）

```bash
# 先更新 dev
git checkout dev/delicious233
git pull

# Wave 2 worktree 从最新 dev 创建
git worktree add ../.worktrees/feat-settings-css-split -b feat/settings-css-split dev/delicious233
git worktree add ../.worktrees/feat-im-css-modular -b feat/im-css-modular dev/delicious233
# ...
```

### 清理

```bash
git worktree remove ../.worktrees/feat-web-mock-cleanup
git branch -d feat/web-mock-cleanup
```

---

## 8. 进度跟踪

| Worktree | 状态 | Agent | 开始 | 完成 | PR |
|----------|------|-------|------|------|-----|
| WT-A `feat/web-mock-cleanup` | 待分配 | - | - | - | - |
| WT-B `feat/chat-stub-fixes` | 待分配 | - | - | - | - |
| WT-C `feat/settings-extraction` | 待分配 | - | - | - | - |
| WT-D `feat/glass-tokens` | 待分配 | - | - | - | - |
| WT-E `feat/git-hygiene-backend` | 待分配 | - | - | - | - |
| WT-A2 `feat/web-tests` | 等 WT-A | - | - | - | - |
| WT-B2 `feat/im-css-modular` | 等 WT-B | - | - | - | - |
| WT-C2 `feat/settings-css-split` | 等 WT-C | - | - | - | - |
| WT-D2 `feat/web-light-theme` | 待分配 | - | - | - | - |
| WT-E2 `feat/i18n-cleanup` | 待分配 | - | - | - | - |
| WT-C3 `feat/settings-i18n-polish` | 等 WT-C+E2 | - | - | - | - |
| WT-F `feat/backend-docs` | 待分配 | - | - | - | - |
| WT-G `feat/visual-regression-tests` | 等 WT-C+D | - | - | - | - |
