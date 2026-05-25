# 文档规范

最后更新：2026-05-25

## 文档分层

| 层级 | 目录 | 内容 | 读者 | 修改权限 |
|------|------|------|------|:--:|
| **项目事实** | `docs/roadmap.md` | 全局路线图，唯一进度台账 | 全员 | Delicious233 |
| **产品** | `docs/architecture/product-requirements.md` | 产品定位和需求 | 全员 | 三人协商 |
| **架构** | `docs/architecture/system-architecture.md` | 系统设计和拓扑 | 开发者 | 三人协商 |
| **实现** | `docs/architecture/implementation-guide.md` | 开发规范和流程 | 开发者 | 三人协商 |
| **客户端** | `docs/roadmaps/client.md` | Desktop 路线图 | 前端 | Delicious233 |
| **集成** | `docs/roadmaps/integration.md` | Hub↔Edge 对接方案 | 后端 | 三人协商 |
| **设计规格** | `docs/architecture/design/` | 架构细节/参考模式（长文） | 开发者 | 任何人 |
| **参考研究** | `docs/reference/` | 21 项目竞品分析，按问题检索 | 按需查阅 | 任何人 |
| **审计报告** | `docs/review/` | 代码/测试/工程审计 | 开发者 | 任何人 |
| **收件箱** | `docs/inbox/` | Agent 间通信，本地不提交 | Agent | Agent |

## 命名和格式

- 文件名用小写和连字符：`product-requirements.md`
- 中文优先，代码标识保持英文
- 每个文件开头标注最后更新日期
- **不写绝对路径**（`D:\Code\TokenDance\AgentHub\...`）
- **不写 `target: master`**（合并目标统一 `dev/delicious233`）

## 路线图规范

- `docs/roadmap.md` 是全局台账，所有进度在这里登记
- roadmap 只写：目标 + 任务清单 + 验收命令 + 依赖
- 详细设计、代码片段、伪代码放 `docs/architecture/design/`
- 竞品引用、采纳映射放 `docs/reference/`

## 禁止事项

- 同一事实出现在多个文档中（README 底部和 roadmap 各写一遍进度）
- 用 "M1"/"M3a"/"mock run" 等过时阶段名描述当前状态
- 文档中写本机路径或个人信息
- 在 AGENTS.md 中单方面添加规则（三人共享文件）
