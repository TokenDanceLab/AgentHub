---
name: dev-loop
description: "自主开发推进引擎——ROADMAP 驱动、模型分配、并行 subagent 协作、交叉审查、文档同步、自动沉淀。长程多步骤任务使用 /dev-loop 启动。短任务（单文件修复、小改动）不需要——直接做。"
---

# Dev Loop — 自主开发推进引擎

> 短任务（单文件修复、typo、小改动）**不需要这个 skill**——直接做，别绕弯。
> 长程任务（跨文件重构、多步骤功能、需要审查的变更）用它。

## 模型分配策略

| 别名 | 后端 | 上下文 | 角色 | 策略 |
|---|---|---|---|---|
| **opus** | deepseek-v4-pro | 1M | 推理/架构/审查 | 稳定可靠 |
| **sonnet** | deepseek-v4-flash | 1M | 快速并行执行 | 批量机械工作 |
| **haiku** | glm-5.1 | **200k** | 简短复杂逻辑/业务编码 | 优先编码，上下文小是硬限制 |

## CC 原生工具配合

dev-loop 配合两个 CC 内置命令使用效果最好：

### `/goal` — 会话目标锁
- 用法：`/goal "完成 server 文档中文化"`
- 设置后，会话未达目标前 `/stop` 被阻止
- 适用于：一个明确的、可在本次会话完成的目标
- 完成后自动解除。中途变更目标用 `/goal` 重新设置

### `/loop` — 定时自触发
- 用法：`/loop 10m 继续完善项目，运行测试，提交代码`
- 适用于：需要持续关注的项目、长时间运行的迭代任务
- 选择间隔时注意：< 5 分钟保持 prompt cache 热，> 5 分钟 cache 失效但有更长自主窗口
- 如果没有具体的外部信号需要轮询，默认 20-30 分钟

**组合使用：** `/goal "完成翻译并清理"` + `/loop 10m /dev-loop 继续推进剩下的工作`

## 标准工作循环

### 1. 理解
- 读 AGENTS.md / CLAUDE.md / README.md / ROADMAP.md / STATE.md
- 理解现有架构、约定、当前进度

### 2. 规划
- 长期任务：创建 ROADMAP.md 或在现有 ROADMAP 中登记任务
- 本次会话目标明确 → `/goal "描述"` 锁定，防止中途退出
- 用平台 goal/todo 工具跟踪 session 状态（ROADMAP.md 是跨 session 权威）
- 从 ROADMAP 中选取 1-3 个最高价值任务
- 不确定的设计先做轻量探索（只读 agent）

### 3. 执行
- **自己（opus 主 session）**：设计决策、审查输出、编辑核心文件（AGENTS.md/STATE.md/ROADMAP.md）
- **派 opus subagent**：复杂功能、架构重构、安全审查、多维度审计
- **派 sonnet subagent**：批量机械工作（翻译、格式化、测试生成、重命名）
- **派 haiku subagent**：编码实现、bug 修复、算法。优先用 haiku，实际失败才换 opus
- 每次 subagent 完成后审查其输出

### 4. 审查
- 完成一批变更后启动交叉审查：4-5 个 opus agent 并行
- 维度：结构、文档、安全、架构、易用性
- 让其他 agent 提问题："审查这个变更，列出你担心的问题"
- 修复高优先级项

### 5. 同步
- AGENTS.md / CLAUDE.md（规则变更）
- STATE.md（事实变更）
- ROADMAP.md（标记完成、记录阻塞、写下一步）
- 运行 `neat-freak` 清理过时文档
- 运行 `memory-management` 同步 memory（如有跨系统需求）
- Git：小范围 commit，及时 push

### 6. 沉淀
- 发现可复用的 SOP → 写成项目级 skill
- Skill 不含本机路径、凭据、IP——别人也能用
- 自己调用测试，迭代描述和触发条件

## Worktree 指南

**什么时候用：**
- 跨 session 重构（跨天、跨对话）
- 可能破坏主分支的实验性变更
- 并行开发多个独立功能

**什么时候不用：**
- 单文件修复、文档变更 → 直接在主分支
- 90% 的工作不需要 worktree

## 审查模式

### 交叉审查维度与模型
| 维度 | 模型 | 为什么 |
|---|---|---|
| 结构 | sonnet | 机械检查，批量扫文件 |
| 文档 | sonnet | 一致性检查，不重推理 |
| 安全 | **opus** | 必须深度推理 |
| 架构 | **opus** | 需要设计判断 |
| 易用性 | sonnet | 清单式检查 |
| 业务逻辑 | **haiku** | 简短复杂逻辑审查 |

审查 agent 的 prompt 要具体：告诉它查什么、怎么报告、文件在哪。

### 自我质疑
- "新 agent 能理解吗？" "STATE.md 需要更新吗？"
- "有文件引用过时路径吗？" "memory 同步了吗？"
- "这个改动影响了其他项目吗？"

## 产品思维

- 用户第一次用怎么想？错误信息有用吗？
- 测试覆盖了真实场景还是只测 happy path？
- E2E 能跑通完整用户流程吗？界面一致吗？

## Git 约定

- `main` 稳定，`dev` 开发；小范围 commit，及时 push
- 不用 `--force`、`--no-verify`
- Commit message 写"为什么"不是"做了什么"

## 自主边界

**无需确认可直接做：** 读文件、写代码、加测试、更新文档、跑本地命令、派 subagent、小范围 commit。

**必须暂停等确认：** 生产部署、破坏性数据变更、secret 处理、不可逆迁移、超出 ROADMAP 范围的大重写。

**受阻时：** 先尝试直接解决。经过具体尝试仍受阻后，把阻塞点和下一步写入 ROADMAP.md，再问用户。

## 参考

- `references/model-strategy.md` — 模型选择决策树 + fallback 策略
- `references/review-checklist.md` — 代码审查清单
