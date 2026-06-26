# 文档规范

最后更新：2026-06-27

## 文档分层

| 层级 | 文件 | 内容 | 修改权限 |
|------|------|------|:--:|
| **路线图** | `docs/roadmap.md` + `docs/roadmap/` | Sprint 目标 + 模块化路线图 | Delicious233 |
| **架构** | `docs/architecture.md` + `docs/architecture/` | 产品定位 + 三层架构 + 数据流 | 三人协商 |
| **ADR** | `docs/adr/` | 架构决策记录（11 篇） | 任何人 |
| **设计** | `docs/designs/` | 进行中设计文档 | 任何人 |
| **治理** | `docs/governance/` | 分支规范、文档标准、安全风险、威胁模型 | 三人协商 |
| **部署** | `docs/architecture/05-deployment.md` | 部署手册 | 运维 |
| **参考** | `docs/reference/` | 技术参考 + 竞品调研 | 按需查阅 |
| **活跃 SPEC** | `docs/progress/MASTER.md` + `docs/analysis/` + `docs/plan/` | 当前 spec-driven 专项的分析、计划、进度入口；只在专项执行中存在 | 任务负责人 |
| **归档** | `docs/archives/` | 已完成 spec-driven 专项和过期项目 skill 的只读归档 | 任务负责人 |

## 命名和格式

- 文件名用小写和连字符：`product-requirements.md`
- 中文优先，代码标识保持英文
- 每个文件开头标注 `最后更新：YYYY-MM-DD`
- 不写绝对路径（`D:\Code\...`）
- 不写 `target: master`（合并目标统一 `dev/delicious233`）
- 不引用源码行号（用函数名/类型名等稳定锚点）

## 规则

1. **路线图唯一**：当前目标和优先级写在 `roadmap/`，完成打钩，不另建第二套 backlog
2. **主文档优先**：架构说明写进 `architecture.md` + `architecture/`
3. **活跃 SPEC 入口唯一**：只有存在 `docs/progress/MASTER.md` 时，`docs/analysis/` 和 `docs/plan/` 才表示当前 spec-driven 专项；任务细节以 MASTER 指向的 GitHub issue 或计划文档为准
4. **归档边界清楚**：完成的 spec-driven 工件移入 `docs/archives/<topic>/`；过期项目 skill 放入 `docs/archives/project-skills/` 只作历史参考，不能作为 active workflow 加载
5. **过时即删**：不再使用的长期文档直接删除（git 历史保留追溯能力）；spec-driven 工件和项目 skill 归档是例外
6. 同一事实不出现在多个文档中
7. 不用过时阶段名描述当前状态

## 新文档检查清单

创建新文档前先确认：
- 能否合并到现有主文档（roadmap / architecture / 当前阶段计划）？
- 是否属于 ADR 或设计文档？
- 读者是谁？新人还是团队成员？对应写到哪一层？
- 如果是 spec-driven 过程材料，是否已有活跃 `docs/progress/MASTER.md`？如果没有，先建立 MASTER，不要散落新计划文件
