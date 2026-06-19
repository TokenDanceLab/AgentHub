# AgentHub v0.5.0 Roadmap

> 2026-06-19 · 基于 v0.4.0 + SUPER 工程修复 Phase 1/4/5 完成
> 上一版本详细 roadmap 已归档至 `docs/archive/roadmap-v0.3.0/`

---

## SUPER 工程修复进度

> 基于 [SUPER 工程审计](../governance/super-score-2026-06-19.md)（63/100），52 任务 6 Phase。

| Phase | 名称 | 进度 | 状态 |
|---|---|---|---|
| Phase 1 | 后端安全与基础 | 12/12 | ✅ 完成 |
| Phase 4 | 前端与 Mobile 质量 | 5/5 | ✅ 完成 |
| Phase 5 | 文档、平台与打磨 | 4/17 (Lane A) | ✅ Lane A 完成 |
| **Phase 2** | **Edge 安全加固** | **0/7** | **🟡 执行中** |
| **Phase 3** | **架构重构** | **0/5** | **🟡 执行中** |
| Phase 6 | 延后 | 0/4 | 待启动 |

**Phase 1 完成验证**：hub-server 20/20 ✅ · edge-server 20/20 ✅ · Mobile tsc 0 errors ✅ · CSP/DOMPurify/Redis blacklist ✅
**当前活跃**：Phase 2 + Phase 3 并行执行中

---

## 0. 基线

| 维度 | v0.3.0 交付 |
|------|------------|
| IM 功能 | 13/13 ✅ |
| 右侧栏预览 | 14/14 ✅ |
| 管线代码 | 12/12 (8 done + 4 code-written) |
| 一键部署 | ✅ `*.pages.vectorcontrol.tech` |
| hk2 生产 | ✅ Hub Docker + Edge systemd |
| Desktop/Mobile/Web | ✅ 三端皆通 |
| 测试 | 41/41 Go · 0 TS errors · 88/88 Gate |
| APK | ✅ Release arm64-v8a 29.83 MB (2026-06-10) |

---

## 1. v0.4.0 主线目标

### P0: 运行验证（代码已写，需要跑起来）

| # | 项目 | 内容 |
|---|------|------|
| 1 | **Orchestrator 端到端** | 4 个 Go 文件在真实 Edge + 多 Agent 任务中跑通 |
| 2 | **RunEvent replay** | 前端断线重连增量补齐闭环 |
| 3 | **Surfacing 自动升格** | Agent 写文件 → 聊天流内联预览卡片全流程 |
| 4 | **@Agent E2E** | Web OIDC 登录 → 群聊 @Agent → Hub dispatch → Edge → CC CLI → transcript 渲染 |

### P1: 功能补全

| # | 项目 | 内容 | 竞品驱动 |
|---|------|------|----------|
| 5 | **对话式创建 Agent** | 比赛要求"对话式创建"——当前只有表单版 | GuqierMcl InstructAgent |
| 6 | ~~**Android APK 构建**~~ ✅ | Release arm64-v8a 29.83 MB (2026-06-10) | — |
| 7 | **OIDC 全链路验证** ✅ | TokenDance ID → Hub → JWT → WS 完整重验（SUPER Phase 1 安全加固已验证） | — |
| 8 | **演示材料** | 3-5 支视频 + 5-7 张截图 | SeiyunSky 7 视频(Pres=9) |

### P2: 优化

| # | 项目 | 内容 | 竞品驱动 |
|---|------|------|----------|
| 9 | **cc-switch 模型可视化** | Agent 配置页显示真实模型别名 | — |
| 10 | **Settings 完善** | preferences 跨端同步 | — |
| 11 | **性能** | Edge event store 压缩、Hub WS 连接池 | — |
| 12 | **文档** | API 参考文档、部署手册 | — |

### P3: 竞品驱动补强（40 仓审计发现的高价值缺失）

| # | 项目 | 来源 | 内容 | 预计 |
|---|------|------|------|------|
| 13 | **上下文压缩器** | SeiyunSky (3 层) | `context_budget.go` 已有结构——补接线：micro_compact(工具输出折叠) → global_summarize(LLM 总结 2000 字) → 渐进式触发。解决长对话 token 溢出 | 60m |
| 14 | **Turn/撤销系统** | doloveplayer (TurnManager 367 行) | 消息操作的版本感：重新生成后旧回复可切回、undo 占位符、版本切换器。已在 W1-1 消息操作中部分覆盖，补 TurnBoundary 组件 | 90m |
| 15 | **COMPETE 编排模式** | Queena (SPLIT/COMPETE/PIPELINE) | 同任务派给 2+ agent 并行执行 → 聚合对比摘要而非 merge。Orchestrator dispatch 已支持并行，补 compete 聚合逻辑 | 45m |
| 16 | **E2E 链路一键冒烟** | W0-1 分解 | `verify-real-api-smoke.ps1` 拆为单命令可跑的子脚本，补"一键 @Agent 全链路"模式（OIDC → 群聊 → dispatch → Edge → CLI → transcript）| 30m |
| 17 | **AI_COLLABORATION.md** | Queena/DDJH44 (376 条记录) | 从 `.agents/` + 11 ADR + superpowers + 46 git commits today 导出一份结构化的 AI 协作证据文档。不是代码，但考核权重 30% | 20m |

### P4: 不做但需要答辩准备的

| # | 项目 | 为什么不做 | 答辩话术 |
|---|------|------------|----------|
| — | Matrix 协议 | 架构选择差异 | "Hub-Edge 需要实时云同步+本地离线执行，类型化 WS 事件有 OpenAPI 文档" |
| — | K8s 控制平面 | 过度设计 | "Edge lifecycle+adapter registry 已实现同等能力，17 文件 reconsile 循环对比赛项目过重" |
| — | 力导向 DAG 图 | 太重 | "`<ul>` 树 + DagTree 组件已覆盖 AgentTeam 进度可视化需求" |
| — | PPT 导出 | P2 可选项 | "PPT/Slideshow **预览** 已通过 SlideshowPreview 组件完成，导出是 nice-to-have" |

---

## 2. 不做（明确排除）

- macOS 签名/公证 — 缺硬件
- iOS 端 — 缺设备 + 证书
- 力导向 DAG 图 — `<ul>` tree 够用
- Matrix 协议 — 架构选择差异
- 竞品再审计 — 窗口已关

---

## 3. 里程碑

| Milestone | 内容 | 目标日期 |
|-----------|------|----------|
| M1: 全链路通 | Orchestrator E2E + @Agent E2E + replay + surfacing | TBD |
| M2: 比赛交付 | 对话式创建 + OIDC + 演示材料 | TBD |
| M3: v0.5.0-rc1 | 命令余项 + ~~APK~~ ✅ + 文档 + SUPER Phase 1/4/5 完成 | TBD |
