# 04 — 竞品驱动优先级

> 基于最新全量拉取（2026-06-10）后的威胁重评。
> 完整对比见 [COMPETITOR-THREAT-REASSESSMENT-2026-06-10.md](../../docs/competitors/COMPETITOR-THREAT-REASSESSMENT-2026-06-10.md)。

---

## 为什么竞品分析要反馈到 Roadmap

DDL 已过，40+ 竞品冻结。开发竞速结束。现在决定排名的不是"谁写得多"，而是"评委 3 分钟能看到什么"。我们必须用最短时间补**最有演示价值的东西**。

## 按演示价值重排的执行顺序

| 顺序 | 功能 | 演示收益 | 我们的差距 | 路线图 | 竞品对标 |
|---|---|---|---|---|---|
| 1 | **Agent streaming bar + StepCard** | 评委一屏看全多 Agent 状态——"看出来这些 Agent 真的在协作" | 聊天流看不到 Agent 执行过程 | [02 #1](02-light-ui.md) + [02 #5](02-light-ui.md) | Queena StepCard + SeiyunSky AgentTypingBar |
| 2 | **RunEvent 持久化 replay** | 刷新不丢数据——"工程可靠性的最低门槛" | 刷新丢聊天历史 | [01 #3](01-pipeline.md) | GuqierMcl timeline-projection (⚠️ 竞品已在做) |
| 3 | **文件预览增强 (PDF/PPT/Excel/DOCX)** | Agent 产物一栏全预览——"生成效果质量直接拉满" | 只有图片和网页预览 | [03 #6-10](03-right-panel.md) | DDJH44 RightPanel 8 tab 产物 |
| 4 | **Surfacing 自动升格** | Agent 写完文件自动出卡片——"整个工作流是自动的" | 产物要手动去文件 tab 找 | [01 #4](01-pipeline.md) | Queena SurfacingCard |
| 5 | **Dial apply 写回 workdir** | 接受 diff 后文件真的变了——"不是演示道具" | DiffViewer 只是状态标记 | [01 #2](01-pipeline.md) | Queena applyHunks |
| 6 | **DagTree** | 多 Agent 任务树——"比单 Agent 强在哪里" | Overview tab 空白 | [03 #13](03-right-panel.md) | doloveplayer DAG |
| 7 | **MCP 运行时集成** | 比赛明确要求的 MCP——"MCP 是标配" | ADR-010 已定义，runtime 适配中 | [01 #1](01-pipeline.md) | SeiyunSky MCP Client（311 行）+ metrogg MCP |
| 8 | **文档预览格式族** | 一个 tab 看所有格式——"不只是代码工具" | 只有代码/图片预览 | [03 #1-10](03-right-panel.md) | metrogg ArtifactPreviewSurface + DDJH44 |
| 9 | **多模态消息** | IM 发图片/文件——"不只是文字聊天" | IM 纯文本 | [03](03-right-panel.md) | GuqierMcl 图片上传 + 多模态契约 |

### 竞品特化回应

| 如果评委看了... | 我们必须在演示中... | 相关功能 |
|---|---|---|
| GuqierMcl 的 timeline-projection | 先展示 RunEvent replay（刷新不丢数据），再展示我们 Go 后端架构深度是他们 TS 做不到的 | [01 #3](01-pipeline.md) |
| Queena 的 StepCard | 用 RunStepGroupTranscriptBlock（已定义）+ 轻 UI 展示同等能力，同时强调我们的 block 类型比他们多 3 倍 | [02 #5](02-light-ui.md) |
| DDJH44 的完整 IM | 展示 AgentTeam 22 端点全链路——IM 基础功能我们后端已经覆盖，只是前端没露完 | [00 state](00-state.md) |
| SeiyunSky 的 7 视频 | 录 3-5 支视频（三端/三Runtime/审批/Diff/产物预览）。代码量碾压 + 视频补齐 = 全面压制 | 录屏（需你操作） |

---

## 不要补的（战略选择）

| 竞品强项 | 不补的理由 |
|---|---|
| 对话式创建 Agent (GuqierMcl) | 需要新聊天交互流，改动太多。表单配置已够用，对话式等下个版本。|
| 力导向 DAG 图 (Toufumind WorkflowArch 233 行) | 太重。用 `<ul>` 缩进树（30 分钟）传达同样的信息。|
| Matrix 协议 (metrogg) | 架构选择差异。准备答辩回应即可。|
| K8s 控制器平面 (metrogg 17 文件) | 过度设计。我们的 Edge lifecycle 不需要。|
| 6 种部署方式 (DDJH44) | 1 种能演示就够。部署闭环下个版本。|
| PPT 导出 (MasterOfAgents) | PPT **预览** 就够了（[03 #6](03-right-panel.md)），导出是 nice-to-have。|
