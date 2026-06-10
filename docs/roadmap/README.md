# AgentHub Roadmap

> 最后更新：2026-06-10 · 入口文件
>
> 本文是 roadmap 体系的目录，不再承载单一巨型文档。每条子文档聚焦一类工作，均有状态标记、验收标准、互相引用。

## 📖 目录

| 文档 | 内容 | 读者 |
|---|---|---|
| [00 现有资产与缺口](00-state.md) | 已完成能力清单、未接通 gap、当前数据流状态 | 开始任何工作前先对现状 |
| [01 管线类功能](01-pipeline.md) | 不需要新 UI、纯后端/合同层接线 | agent 可直接执行 |
| [02 轻 UI 接线](02-light-ui.md) | 复用现有组件 + 少量 CSS，不动主聊天流 | agent 主导，少量 UI review |
| [03 右侧栏增强](03-right-panel.md) | 需要新 UI 面，但全在右侧 inspector 内 | 需要 UI 方向确认 |
| [04 竞品驱动优先级](04-competition-gap.md) | 竞品强项对照 + 威胁评估 → 优先级修正 | 决策参考 |
| [07 bytedance.md 对照缺口](07-bytedance-gaps.md) | 逐条对照比赛课题全部要求，标记 ✅/⚠️/❌ + 未入 Roadmap 的缺口 | 交付前最终审计 |
| [05 收口标准与 Release Gate](05-release-gates.md) | 每条功能"完成"的验收标准 + release gate 清单 | 做完后逐项打钩 |

## 🌐 相关文档

| 文档 | 位置 |
|---|---|
| 右侧栏增强详细设计 | [right-panel-enhancement-design.md](../right-panel-enhancement-design.md) |
| 竞品威胁重评（2026-06-10） | [COMPETITOR-THREAT-REASSESSMENT-2026-06-10.md](../../docs/competitors/COMPETITOR-THREAT-REASSESSMENT-2026-06-10.md) |
| 竞品创新 backlog | [COMPETITOR-INNOVATION-BACKLOG-2026-06-10.md](../../docs/competitors/COMPETITOR-INNOVATION-BACKLOG-2026-06-10.md) |
| 架构文档 | [architecture.md](../architecture.md) |

## 工作哲学

```
不动主聊天流（TranscriptView + Composer）
只动两条路：
  → 后端/合同层（Edge + Hub Go 代码、shared types）
  → 右侧检视面板（RightInspector: overview/browser/files 三个 tab）
Pipeline 类 agent 秒级搞定，UI 类需要定交互方向后落地。
```
