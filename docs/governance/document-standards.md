# 文档规范

最后更新：2026-06-27

## 文档分层

| 层级 | 文件 | 内容 | 修改权限 |
|------|------|------|:--:|
| **项目总规则** | `AGENTS.md` | 开发红线、工作流、事实源分层、skill 白名单、提交和验证规则 | 三人协商 |
| **当前 SPEC** | `docs/progress/MASTER.md` + `docs/analysis/` + `docs/plan/` | 当前 spec-driven 专项的分析、计划、进度入口；只在专项执行中存在 | 任务负责人 |
| **总进度** | `docs/roadmap.md` | 总路线、模块级进度、长期 backlog 和下一步 | Delicious233 |
| **架构** | `docs/architecture.md` + `docs/architecture/` | 产品定位 + 三层架构 + 数据流 | 三人协商 |
| **ADR** | `docs/adr/` | 架构决策记录（11 篇） | 任何人 |
| **设计** | `docs/design-decisions.md`、`docs/adr/` 或 scoped design doc | 当前设计决策；完成或过期设计归档 | 任何人 |
| **治理** | `docs/governance/` | 分支规范、文档标准、安全风险、威胁模型 | 三人协商 |
| **部署** | `docs/architecture/05-deployment.md` | 部署手册 | 运维 |
| **参考** | `docs/reference/` | 技术参考 + 竞品调研 | 按需查阅 |
| **归档** | `docs/archives/` | 已完成 spec-driven 专项和过期项目 skill 的只读归档 | 任务负责人 |

## 命名和格式

- 文件名用小写和连字符：`product-requirements.md`
- 中文优先，代码标识保持英文
- 每个文件开头标注 `最后更新：YYYY-MM-DD`
- 不写绝对路径（`D:\Code\...`）
- 不写 `target: master`（合并目标统一 `dev/delicious233`）
- 不引用源码行号（用函数名/类型名等稳定锚点）

## 规则

1. **规则唯一**：项目总规则只写 `AGENTS.md`。不再创建 `CLAUDE.md`、平台专用根规则或第二套工作流说明。
2. **当前 SPEC 唯一**：只有存在 `docs/progress/MASTER.md` 时，`docs/analysis/` 和 `docs/plan/` 才表示当前 spec-driven 专项；任务细节以 MASTER 指向的 GitHub issue 或计划文档为准。
3. **总进度唯一**：长期目标、模块进度和 backlog 写入 `docs/roadmap.md`；不要把当前 PR 阻塞、临时验收日志或分支 live 状态长期写进 roadmap。
4. **架构唯一**：架构说明写进 `docs/architecture.md` + `docs/architecture/`；roadmap 只链接或摘要，不复制协议细节。
5. **事实 owner 唯一**：同一事实只能有一个 owner 文件；其他文件只链接或保留一句摘要。
6. **归档边界清楚**：完成的 spec-driven 工件移入 `docs/archives/<topic>/`；过期项目 skill 放入 `docs/archives/project-skills/` 只作历史参考，不能作为 active workflow 加载。
7. **过时即删**：不再使用的长期文档直接删除（git 历史保留追溯能力）；spec-driven 工件和项目 skill 归档是例外。
8. **避免巨石文档**：`AGENTS.md`、`MASTER.md`、`roadmap.md` 和 `architecture.md` 只保留入口、摘要、当前事实和稳定索引；长表、历史日志、专题设计、验收证据拆到 owner 子文档、`docs/archive/` 或 `docs/archives/`。
9. 不用过时阶段名描述当前状态。

## 新文档检查清单

创建新文档前先确认：
- 能否合并到现有 owner 文件（AGENTS / MASTER / roadmap / architecture）？
- 是否属于 ADR 或设计文档？
- 会不会把主文档继续变成巨石文档？如果会，先拆到 owner 子文档并在主文档只留链接。
- 读者是谁？新人还是团队成员？对应写到哪一层？
- 如果是 spec-driven 过程材料，是否已有活跃 `docs/progress/MASTER.md`？如果没有，先建立 MASTER，不要散落新计划文件
