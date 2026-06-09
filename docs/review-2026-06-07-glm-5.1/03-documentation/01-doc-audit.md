# AgentHub 文档治理审计报告

> 审计日期：2026-06-07 | 审计范围：docs/ + 根级文档 + 子项目 README | 审计模型：GLM-5.1 (DeepSeek-V4-Pro) | 严格只读

---

## 1. 文档与代码一致性

### 1.1 roadmap.md 架构描述 vs 当前代码

🟢 **roadmap.md 与代码高度一致**。`docs/roadmap.md` 的当前执行快照正确反映：
- 主工作树 `feat/desktop-web-v4-clean-rebuild`（git 确认）
- shared workbench 子组件（GlobalRail、ConversationSidebar、TranscriptView、UnifiedComposer、RightInspector）均已存在
- Desktop 5173 / Web 5174 端口分配
- 旧 UI 删除状态（ChatView/PromptInput/ThreadPanel/RunDetail 已删除）
- `scripts/verify-v4-old-ui-active-paths.ps1` 44/44 通过

🟡 **10/40 checkbox 未勾选**。roadmap.md P0-P5 共 40 个待办项中 10 个已勾选、30 个未勾选。其中 P0-1 "更新 README、docs 导航，移除旧状态入口" 和 "确认 active docs 不再表达旧主线" 仍未勾选，与本次审计发现一致。

🟡 **验证记录膨胀**。roadmap.md 单文件已达 ~185 行，其中 ~100 行是验证记录（含完整命令行和截图文件大小）。建议验证记录改为引用 CI 证据或移入 `docs/archive/` 快照。

### 1.2 desktop-web-v4-clean-rebuild-plan.md 复选框 vs 实际代码

🟢 **rebuild plan 与代码基本一致**。25/60 checkbox 已勾选，Task 1 (文档合同)、Task 10 (旧 UI 清理) 大部分完成。

🟡 **Task 2 (shared UI public API 清理) 全部未勾选**。`app/shared/src/ui/index.ts` 的 exports 清理、smoke tests、lint 全部标记未完成。代码中这些组件确实存在但 exports 未规范化。

🟡 **Task 9 (Tauri Host API 拆分) 全部未勾选**。`src-tauri/src/commands.rs` 仍为 945 行巨石。roadmap 标记为 P0-5 "未开始"，plan 标记为 Task 9 全部待办，两者一致。

### 1.3 README.md 描述 vs 当前项目状态

🟢 **README.md 架构描述基本准确**。三层架构（Desktop/Web/Mobile -> Edge -> Hub）、端口分配、技术栈描述与代码一致。

🟡 **README.md 截图可能过时**。`screenshots/web-app.png` 最后修改 2026-05-25，但 v4 工作台已在 2026-06-07 发生重大视觉变更（旧 ChatView 已删除，shared workbench 已接入）。截图未同步更新。

🟡 **README.md 版本号显示 v0.3.0**，但 CHANGELOG.md 和实际功能进展远超 v0.3.0 范畴（已包含 Hub OIDC、TeamRun、v4 workbench 等）。版本号可能需要更新。

🟡 **README.md "产品分层" 描述滞后**。P0 Desktop Command Center 标记为 "P0 [check]"，但 v4 shared workbench 重构已大幅改变 Desktop 架构。IM Collaboration 标记为 "P1 [wrench]" 但 Hub IM 已有大量实现。

### 1.4 AGENTS.md 约定适用性

🟢 **AGENTS.md 大部分约定仍然适用**。三人分工、端口分配、Git 规则、安全规则、文档规则均与当前实践一致。

🟢 **模型分配策略已更新**，正确反映当前 GLM-5.1 为实现主力。

🟡 **AGENTS.md 2. 节渐进式加载引用了 `docs/handoffs/STATE.md`**，但该文件实际是部署状态记录，不是新开发者需要阅读的入门文档。

---

## 2. 过期文档

### 2.1 修改日期分析

🟢 **所有 docs/ 顶层文档在 2026-06-07 更新过**（roadmap、architecture、rebuild plan、decision questions、README）。

🟢 **governance/ 文档在 2026-06-02~06-07 更新过**。

🟢 **docs/ 下无超过 30 天未更新的 .md 文件**（所有文件的 mtime 都在 2026-05-25 之后）。

🟡 **docs/ 总量 243 个 .md 文件，其中 92 个在 archive/、101 个在 reference/**。archive 和 reference 占总量的 79.4%，活跃文档仅约 50 个。

### 2.2 活跃位置的时间戳快照文档

🟡 **docs/review/ 下有 2 个活跃文件**（2026-06-06 的 round6 executive-summary 和 submission-gap），未归档但带有日期快照名。`docs/review/archive/` 下有 12 个已归档 review。按 document-standards.md 规则 "时间戳快照归档到 archive/"，这两个文件应归档。

🟡 **docs/competition/teamrun-e2e-evidence.md** 是 2026-06-05 的竞赛证据文件，放在活跃位置。如果竞赛已结束，应归档。

🟡 **docs/handoffs/ 下 4 个文件**，其中 `SESSION-HANDOFF-2026-06-05.md` 和 `claude-session-20260605.md` 带有日期快照名，按规范应考虑归档。

### 2.3 根级临时文件

🔴 **`BACKEND-MERGE-PLAN.md` 是未跟踪的根级文件**（git status 显示 `??`）。这是一次性 merge 分析文档（分析 origin/dev/johnny 到 feat/backend-edge-hub 的合并方案），不属于项目长期文档。建议：
- 完成合并后删除
- 或移入 `docs/archive/` 
- 不应提交到仓库根目录

---

## 3. 文档路径引用完整性

### 3.1 内部路径

🟢 **roadmap.md 引用的所有内部路径均存在**：architecture.md、rebuild plan、decision questions、branch governance、两个 archive roadmap 文件。

🟢 **docs/README.md 引用的路径均存在**。

🔴 **docs/adr/README.md 引用了 `docs/architecture/system-architecture.md` 和 `docs/architecture/implementation-guide.md`**，但这两个文件不存在。当前架构文档是 `docs/architecture.md`（单文件）。这是过期引用，应修正为 `docs/architecture.md`。

### 3.2 跨仓库路径

🟡 **docs/governance/governance-execution.md 的 Root Inputs 引用了 10 个 `../` 相对路径**（如 `../../docs/ecosystem/ecosystem-execution-queue.md`）。验证结果：虽然 `D:/Code/TokenDance/docs/` 目录存在，但这些具体文件未验证可访问性。这些引用指向 TokenDance workspace 级文档，仅在完整 workspace 克隆时有效，不影响仓库内独立性。

---

## 4. 缺失文档

### 4.1 子项目 README

🟢 **所有关键子项目均有 README**：`app/desktop/`、`app/web/`、`app/shared/`、`app/mobile/`、`edge-server/`、`hub-server/`、`api/`。

🟡 **无 `app/e2e/` README**。但 `app/e2e/` 目录可能不存在或为空，不影响开发。

### 4.2 贡献指南

🟢 **`CONTRIBUTING.md` 存在**。最后更新 2026-05-25。根级有 CONTRIBUTING.md。

### 4.3 架构决策记录 (ADR)

🟢 **11 篇 ADR 完整存在**（ADR-001 到 ADR-011），与 docs/README.md 声明一致。

🟡 **ADR README 列出 3 个候选 ADR 主题**尚未形成正式 ADR：
1. 独立 `runner/` 合并进 Edge lifecycle 的决策
2. Agent Runtime/Profile/Configuration/Target 四术语边界的决策
3. `/v1/runners` 兼容 API 的去留决策

### 4.4 API 文档

🟢 **`api/openapi.yaml` 和 `api/events.md` 存在**。`api/README.md` 存在。

### 4.5 环境变量文档

🟢 **`.env.example` 存在**（4084 字节，最后更新 2026-06-05）。

🟡 **无独立环境变量说明文档**。`.env.example` 包含示例值但无详细说明。AGENTS.md 第 5 节要求 "如果别人克隆仓库后需要某个配置或命令才能开发，把它写进 README.md 或 .env.example"，当前 `.env.example` 满足基本需求但注释不够充分。

### 4.6 设计文档

🟢 **4 篇设计文档存在**（artifact-lifecycle、enhanced-adapter、client-reference-patterns、unified-error-logging），与 docs/README.md 声明一致。

🟡 **无 v4 工作台设计文档**。当前 v4 重构是最重大的架构变更，但 designs/ 下没有对应的 v4 workbench 设计文档。设计意图散布在 rebuild plan 和 architecture.md 中。

---

## 5. 文档冗余

### 5.1 多文档描述同一件事

🟡 **roadmap.md 和 rebuild-plan.md 存在大量重复**：
- 两者都包含完整的验证记录（命令行、测试结果、截图文件大小）
- 两者都描述相同的任务分解（P0-P5 vs Task 1-10）
- 两者都记录执行记录
- roadmap.md ~185 行，rebuild-plan.md ~418 行，内容重叠度约 40%

建议：roadmap.md 只保留当前快照和优先级表，详细任务和执行记录只放在 rebuild plan。

🟡 **architecture.md 和 rebuild-plan.md 存在重叠**：
- architecture.md 第 3 节 "v4 工作台信息架构" 与 rebuild plan 第 2 节 "UI 壳子参考边界" 描述相同内容
- architecture.md 第 4 节 "前端分层" 与 rebuild plan 第 4 节 "目标文件结构" 高度重叠

建议：architecture.md 保留架构边界和数据流，rebuild plan 保留实施细节。

### 5.2 文档间矛盾

🟢 **roadmap 和 rebuild plan 无重大矛盾**。两者在架构方向、优先级和当前状态上一致。

🟡 **architecture.md 阶段名使用 D0-D6**，而 roadmap 使用 P0-P6。虽然内容对应关系清晰，但阶段命名不统一可能造成混淆。AGENTS.md 第 4 节规则 4 要求"文档中使用当前 Phase 命名"，但两份文档使用了不同的命名体系。

🟡 **rebuild plan Task 1 checkbox "运行 git diff --check" 未勾选**，但 roadmap 声称 v4 分支处于活跃开发状态且多次验证通过。可能是指该检查尚未作为正式门禁流程固定执行。

### 5.3 应归档但仍在活跃位置的文档

🟡 **docs/review/2026-06-06-round6-*.md**（2 个文件）- 按时间戳命名规范应归档到 `docs/review/archive/`。

🟡 **docs/competition/teamrun-e2e-evidence.md** - 竞赛证据文件，如果竞赛周期已结束应归档。

🟡 **docs/handoffs/SESSION-HANDOFF-2026-06-05.md 和 claude-session-20260605.md** - 带日期的会话交接文件，按文档标准第 5 条应归档。

🟡 **根级 `BACKEND-MERGE-PLAN.md`** - 未跟踪的一次性分析文件，不应提交。

---

## 6. 文档计数一致性

### 6.1 docs/README.md 声明 vs 实际

🟢 **ADR 11 篇**：实际 11 篇（ADR-001 到 ADR-011）。一致。

🟢 **设计文档 4 篇**：实际 4 篇。一致。

🟢 **竞品调研 25 个**：实际 25 个项目目录。一致。

🟢 **docs/governance/ 4 篇**：实际 4 篇（security-risk-register、governance-execution、document-standards、branch-governance）。一致。

---

## 7. 文档质量观察

### 7.1 积极方面

- **文档层次清晰**：README -> roadmap -> architecture -> rebuild plan 的渐进式加载设计合理
- **AGENTS.md 作为 Agent 规范非常完善**：涵盖分工、端口、Git 规则、安全红线、质量治理
- **安全风险登记册维护良好**：44 个风险条目，每个有状态、证据和下一步行动
- **归档纪律执行良好**：92 个归档文件有 INDEX.md 索引
- **所有活跃文档在最近 13 天内更新过**

### 7.2 需关注方面

- **roadmap.md 和 rebuild-plan.md 的验证记录正在快速膨胀**，每条都包含完整命令行和文件大小
- **阶段命名不统一**（D0-D6 vs P0-P6）
- **ADR README 有 2 个过期文件路径引用**
- **docs/review/ 和 docs/handoffs/ 有应归档的日期快照文件**
- **根级有一个未跟踪的一次性文档**

---

## 8. 汇总表

| 类别 | 状态 | 发现数 |
|---|:---:|:---:|
| 文档与代码一致性 | 🟡 | 6 |
| 过期文档 | 🟢 | 1 (无>30天过期) |
| 活跃位置的快照文件 | 🟡 | 5 |
| 路径引用断裂 | 🔴 | 1 (ADR README) |
| 跨仓库引用不可验证 | 🟡 | 10 (workspace 级) |
| 缺失文档 | 🟡 | 2 (无 v4 设计文档, env 说明不足) |
| 文档冗余 | 🟡 | 3 (roadmap/plan 重叠, 阶段命名不统一) |
| 应归档未归档 | 🟡 | 5 |
| 文档计数一致性 | 🟢 | 全部一致 |
| 根级临时文件 | 🔴 | 1 (BACKEND-MERGE-PLAN.md) |

**总发现**：🔴 2 / 🟡 16 / 🟢 6

---

## 9. 建议优先级

| 优先级 | 建议 | 影响 |
|---|---|---|
| P0 | 修复 `docs/adr/README.md` 中 2 个断裂路径引用（指向不存在的 system-architecture.md 和 implementation-guide.md） | 新开发者或 Agent 按 ADR README 查找文档会失败 |
| P0 | 处理根级 `BACKEND-MERGE-PLAN.md`：归档或删除 | 未跟踪文件可能被误提交 |
| P1 | 统一 roadmap.md 和 architecture.md 的阶段命名（D0-D6 vs P0-P6） | 消除文档间矛盾 |
| P1 | 将 `docs/review/` 下的 round6 文件和 `docs/handoffs/` 下的日期文件归档 | 按文档标准第 5 条执行 |
| P1 | 更新 `screenshots/web-app.png` 以反映 v4 工作台 | README 展示的是旧 UI |
| P2 | 瘦身 roadmap.md 的验证记录部分，改为引用 CI 证据 | 避免文档过度膨胀 |
| P2 | 减少 roadmap.md 和 rebuild-plan.md 之间的内容重复 | 单一事实源原则 |
| P2 | 补充 v4 工作台设计文档到 `docs/designs/` | 重大架构变更应有独立设计记录 |
| P3 | 为 `.env.example` 补充更详细的注释说明 | 提升新开发者上手体验 |
