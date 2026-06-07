# 文档规范

最后更新：2026-06-07

## 文档分层

| 层级 | 文件 | 内容 | 修改权限 |
|------|------|------|:--:|
| **路线图** | `docs/roadmap.md` | Sprint 目标 + 待办清单 + 已完成汇总 | Delicious233 |
| **架构** | `docs/architecture.md` | 产品定位 + 三层架构 + 数据流 + 实现状态 | 三人协商 |
| **阶段计划/进度** | `docs/<topic>-plan.md` / `docs/<topic>-progress-YYYY-MM-DD.md` | 当前阶段的实施边界、任务、验收、风险和阶段性接手摘要 | 任务负责人 |
| **ADR** | `docs/adr/` | 架构决策记录（11 篇） | 任何人 |
| **设计** | `docs/designs/` | 组件设计文档（4 篇） | 任何人 |
| **治理** | `docs/governance/` | 分支规范、文档标准、安全风险 | 三人协商 |
| **参考** | `docs/reference/` | 技术参考 + 25 项目竞品调研 | 按需查阅 |
| **归档** | `docs/archive/` | 历史方案、旧审查（INDEX.md 为索引） | 只读 |

## 命名和格式

- 文件名用小写和连字符：`product-requirements.md`
- 阶段性进度收口使用 `*-progress-YYYY-MM-DD.md`，必须由 `docs/README.md`、`roadmap.md` 或当前阶段计划链接，不另建状态目录
- 中文优先，代码标识保持英文
- 每个文件开头标注最后更新日期
- 不写绝对路径（`D:\Code\...`）
- 不写 `target: master`（合并目标统一 `dev/delicious233`）

## 规则

1. **路线图唯一**：当前目标和优先级只写在 `roadmap.md`，完成打钩，不另建第二套 backlog
2. **主文档优先**：架构说明写进 `architecture.md`
3. **计划直达**：阶段性实施计划直接放在 `docs/`，并由 roadmap 链接
4. **归档不删**：过时文档移入 `archive/`，不直接删除
5. 同一事实不出现在多个文档中
6. 不用过时阶段名（M1/M3a/mock run）描述当前状态

## 新文档检查清单

创建新文档前先确认：
- 能否合并到现有主文档（roadmap / architecture / 当前阶段计划）？
- 是否属于 ADR 或设计文档？
- 归档类内容是否应放入 `archive/`？
