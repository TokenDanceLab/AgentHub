# AgentHub Roadmap

> 最后更新：2026-06-10 · 入口文件
>
> 本文是 roadmap 体系的目录 + 总览。每条子文档聚焦一类工作，均有状态标记、验收标准、互相引用。

## 📊 总览

| 文档 | 内容 | 项数 | P0 数 | 预计总工时 |
|---|---|---|---|---|
| [01 管线类](01-pipeline.md) | 后端/合同层接线，不需要新 UI | **12** | 10 | ~8 小时（agent 主导） |
| [02 轻 UI 接线](02-light-ui.md) | 复用现有组件 + 少量 CSS | **13** | 11 | ~6 小时（agent 主导 + UI review） |
| [03 右侧栏增强](03-right-panel.md) | Inspector tab 内容增强 + 文件预览 | **14** | 14 | ~4 小时（agent 主导） |
| [06 Orchestrator](06-orchestrator-enhancement.md) | 失败降级、同级上下文、Plan 确认门 | **3** | 3 | ~3 小时（agent 主导） |
| **合计** | | **42** | **38** | **~21 小时** |

| [00 状态与缺口](00-state.md) | 现有资产、gap 清单、竞品基线 | 参照 | — | 开始前先读 |
| [04 竞品优先级](04-competition-gap.md) | 竞品驱动优先级 + 不补清单 | 参照 | — | 决策参考 |
| [05 Release Gate](05-release-gates.md) | 验收标准 + 门禁清单 + 进度 checkbox | 参照 | — | 做完后打钩 |
| [07 bytedance 对照](07-bytedance-gaps.md) | 逐条对照比赛课题 | 参照 | — | 交付前审计 |

## 🎯 最快路径（42 → 仅剩 2 项不在 P0）

```
P0: 38 项，全部被 Roadmap 覆盖
  ├── 管线 10 项：MCP·Diff apply·replay·surfacing·压缩·搜索·allowlist·失败降级·同级上下文·Plan确认
  ├── 轻 UI 11 项：streaming bar·搜索跳转·未读·WS状态·StepCard·Diff交互·Artifact分组·Context·回复·引用·附件
  ├── 右侧栏 14 项：PDF·MD·Code·HTML·图片·PPT·Excel·DOCX·deploy·TXT·streamingBar·ContextUsage·DagTree·deploy切换
  └── Orchestrator 3 项：失败降级·同级上下文·Plan确认

P1（仅 2 项）：结构化 Plan·消息重新生成管线

P2（仅 2 项）：对话式创建 Agent·部署/版本历史（下版本）
```

## 🔄 执行顺序

1. **[06 Orchestrator](06-orchestrator-enhancement.md)**（3 项，3 小时）— 比赛第 2 条核心功能，最高 ROI
2. **[01 管线类](01-pipeline.md)**（12 项，8 小时）— agent 并行干，无 UI 风险
3. **[02 轻 UI](02-light-ui.md)**（13 项，6 小时）— agent 主导 + 你少量 review
4. **[03 右侧栏](03-right-panel.md)**（14 项，4 小时）— 文件预览全格式覆盖

## 📖 目录

| 文档 | 内容 | 读者 |
|---|---|---|
| [00 现有资产与缺口](00-state.md) | 已完成能力清单、未接通 gap、竞品威胁基线 | 开始前先读 |
| [01 管线类功能](01-pipeline.md) | 12 项，不需要新 UI，纯后端/合同层 | agent 可直接执行 |
| [02 轻 UI 接线](02-light-ui.md) | 13 项，复用现有组件 + 少量 CSS | agent 主导，少量 UI review |
| [03 右侧栏增强](03-right-panel.md) | 14 项，全在右侧 inspector 内 | agent 主导 |
| [04 竞品驱动优先级](04-competition-gap.md) | 竞品强项对照 → 优先级修正 + 不补清单 | 决策参考 |
| [05 收口标准与 Release Gate](05-release-gates.md) | 每条验收标准 + 全门禁清单 + 进度 checkbox | 做完后打钩 |
| [06 Orchestrator 增强](06-orchestrator-enhancement.md) | 失败降级/同级上下文/Plan 确认门 | agent 可直接执行 |
| [07 bytedance.md 对照缺口](07-bytedance-gaps.md) | 逐条对照比赛课题全部要求，全部缺口已归口 | 交付前最终审计 |

## 🌐 外部参考

| 文档 | 位置 |
|---|---|
| 右侧栏增强详细设计 | [right-panel-enhancement-design.md](../right-panel-enhancement-design.md) |
| 架构 + 数据流 + 路由表参考 | [roadmap.md](../roadmap.md) |
| 竞品威胁重评 2026-06-10 | [COMPETITOR-THREAT-REASSESSMENT...](../../docs/competitors/COMPETITOR-THREAT-REASSESSMENT-2026-06-10.md) |
| 竞品创新 backlog | [COMPETITOR-INNOVATION-BACKLOG...](../../docs/competitors/COMPETITOR-INNOVATION-BACKLOG-2026-06-10.md) |
| 架构文档 | [architecture.md](../architecture.md) |

## 工作哲学

```
不动主聊天流（TranscriptView + Composer）
只动两条路：
  → 后端/合同层（Edge + Hub Go 代码、shared types）
  → 右侧检视面板（RightInspector: overview/browser/files 三个 tab）
Pipeline 类 agent 秒级搞定，UI 类需要定交互方向后落地。
```
