# Phase 3 — Task Decomposition: ChatView Migration → Merge

> **Date**: 2026-06-17
> **Phase 2 Decisions Confirmed**:
> 1. Monorepo 单版本 (unified version across all packages)
> 2. 现在生成 OpenAPI (swaggo from Go handler tags)
> 3. 现在拆分 AgentHubWorkbench (1500+ → 4 components)
> 4. Squash merge into dev

---

## Execution Plan

### Phase 3A — 完成运行中的审计（无新工作，仅等待 + 提交）

| Lane | 任务 | 工作流 | 状态 |
|------|------|----------|--------|
| A1 | 文档定稿 + 过时归档 | W19 | 🔄 |
| A2 | Desktop Tauri 验收报告 | W20 | 🔄 |
| A3 | API 契约验证（前端↔后端） | W25 | 🔄 |
| A4 | Hub Server 深度审计（handler + 基础设施） | W26 | 🔄 |
| A5 | CSS 死代码清理 | W27 | 🔄 |

**S.U.P.E.R 合规**：全部为分析任务（除清理外只读）—— 无架构风险。

---

### Phase 3B — P0 阻塞项解决（新增，并行 Lane）

| Lane | 任务 | S.U.P.E.R | 设计驱动 | 预估 Agent 数 |
|------|------|-----------|---------------|-------------|
| B1 | **版本对齐** — 将所有 package.json + tauri.conf.json 统一升至 0.4.1，验证一致性 | **E**nvironment-Agnostic | 必须通过 `verify-tauri-package-readiness.ps1` | 2 |
| B2 | **OpenAPI 生成** — 为 Hub handler 添加 swaggo 注解，生成 `openapi.yaml`，验证前端类型匹配 | **P**orts over Implementation | 每个端点的 schema 定义 I/O | 4 |
| B3 | **AgentHubWorkbench 拆分** — 拆分为：`WorkbenchShell`、`ConversationHost`、`ChatViewBridge`、`useWorkbenchCallbacks` | **S**ingle Purpose | 每个 <200 行，单一职责 | 3 |
| B4 | **全量测试重跑** — 重新运行所有 vitest，修复失败，验证 100% 通过 | **R**eplaceable Parts | 所有组件必须有通过测试 | 3 |

**S.U.P.E.R Code Review Checklist** (each task must pass before marking complete):
- [ ] S1: Does each new file have ONE clear purpose?
- [ ] S2: Are there any god objects (>500 lines)?
- [ ] U1: Any circular imports introduced?
- [ ] U2: Data flows one direction (no bidirectional coupling)?
- [ ] P1: Are all module boundaries defined by types/interfaces?
- [ ] P2: Is the API contract explicit (OpenAPI / TypeScript types)?
- [ ] E1: Any hardcoded paths, ports, or environment assumptions?
- [ ] E2: Does it work in both web and desktop contexts?
- [ ] R1: Can each module be tested in isolation?
- [ ] R2: Can each dependency be mocked/swapped?

---

### Phase 3C — 合并前定稿

| Lane | 任务 | 驱动 |
|------|------|--------|
| C1 | 生产构建验证（web + desktop） | 两者必须通过 |
| C2 | 最终隐私重新扫描（零泄露） | `grep -rn "C:\\\\Users\\\\Ding\|Delicious233\|user-ding"` |
| C3 | Git history squash 准备（单一 commit message） | 所有变更摘要 |
| C4 | AGENTS.md / CLAUDE.md 更新 | 反映新模块结构 |

---

## 自适应控制基线

| 指标 | 基线 | 目标 | 偏差预算 |
|--------|----------|--------|--------------|
| 分支提交数 | 67 | Squash 为 1 | — |
| 测试通过率 | 未知 | 100% | 不允许失败 |
| 构建（web） | ❌ 失败 | ✅ 通过 | 必须通过 |
| 构建（desktop） | ❌ 失败 | ✅ 通过 | 必须通过 |
| 隐私泄露 | 0 剩余 | 0 | 无新增泄露 |
| S.U.P.E.R 均分 | 15/25 | 18/25 | +3 提升 |

**偏差阈值**：若任何 P0 任务引入 >2 个新文件且无对应测试 → 轻微（标注）。若 B1-B4 后构建仍然失败 → 显著（暂停，重新拆解）。

---

## GitHub-Native 追踪

Branch: `feat/chatview-tokendance-migration`
Base: `origin/dev/delicious233`
Mode: LOCAL_ONLY（无 `gh` Issue 创建——手动任务追踪）

**合并目标**：Squash merge 到 `dev/delicious233`
**Squash commit message 模板**：
```
feat: ChatView 迁移 + 全面加固

ChatView 设计系统:
- 25 种 TranscriptBlock → 10 种 RowItem 卡片（通过 adapter.ts）
- DAG Orchestrator 可视化（拓扑排序）
- 工具调用/结果 FIFO 合并，Agent 群聊/私聊布局
- react-i18next 统一（90+ key 中/英），CSS token 限定 .chatview 作用域

性能: React.memo 覆盖所有组件，页面懒加载，动态导入
安全: JWT 最低 32 字符，gin.SetTrustedProxies，GORM SQL 清洗器
      MCP Bearer 认证，exec.Command args，CSP 头，DOMPurify
隐私: 18+ 处泄露已修复 — 所有真实路径/名称替换为占位符
架构: 54 个管线测试，694 个总测试，死代码移除
文档: 30+ 文档已更新，CHANGELOG，发布说明，审计报告
```

---

## 阶段门禁

```
Phase 3A（审计）──┐
                  ├──▶ Gate 1: 所有审计报告已撰写，无未关闭严重发现
Phase 3B（P0修复）─┤
                  ├──▶ Gate 2: 构建通过，测试通过，版本对齐
Phase 3C（定稿）──┘
                       ▶ Gate 3: 合并到 dev/delicious233
```
