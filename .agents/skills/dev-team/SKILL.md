---
name: dev-team
description: 多 Team 并行开发引擎 — 大规模 Issue 修复、跨模块攻坚、Team Leader + Worker 模型。5+ 相关 Issue 或跨 3+ 模块时使用。与 dev-loop 互补：dev-loop 管长程单线推进，dev-team 管多线并行攻坚。
---

# Dev Team — 多 Team 并行开发引擎

> 5+ 相关 Issue 或跨 3+ 模块时使用。单一模块 1-3 个 Issue 不需要——直接派单 agent 修。

## 模型

```
你（主 Agent）
  ├── Team Leader 1 (Opus) → Worktree A
  │     ├── Worker 1 → 修 2-3 issues
  │     ├── Worker 2 → 修 2-3 issues
  │     ├── Worker 3 → 修 2-3 issues
  │     └── Worker 4 → 测试 + 审查
  ├── Team Leader 2 (Opus) → Worktree B
  │     └── ... (同上)
  └── ... (最多 5 个 Team 并行)
```

每个 Team 在自己的 worktree 中独立开发，文件范围完全不重叠。

## 何时使用

- 10+ Issue 需要按模块分组修复
- 跨 Hub/Edge/Desktop 多模块改动
- 需要在不同 Go 模块间隔离测试
- 审计报告驱动的批量修复

## 何时不用

- 单模块 1-5 个 Issue → 直接派单 agent
- 纯文档工作 → 单 agent 批量修
- UI 调整 → Desktop agent

## 完整流程

### 阶段 1：信息收集与规划

```bash
# 1. Issue 按模块分组
gh issue list --repo TokenDanceLab/AgentHub --limit 200 --state open --json number,title,labels

# 2. 检查磁盘空间（每个 worktree 约需 500MB-2GB）
df -h

# 3. 确认测试基线
cd edge-server && go test ./... && cd ../hub-server && go test ./...
```

**输出**：Team 划分表（每个 Team 的 Issue 列表 + 文件范围）

### 阶段 2：文件边界规划（最关键步骤）

**核心原则：任何两个 Team 的文件写入范围不能有交集。**

```markdown
| Team | 文件白名单 |
|------|-----------|
| Auth | hub-server/internal/middleware/auth.go, jwtutil/*, service/auth.go |
| Data | hub-server/internal/service/agent.go, repository/agent.go |
| Edge | edge-server/internal/api/handlers.go, events/bus.go, store/* |
```

**检查方法**：`echo $team1_files $team2_files | tr ' ' '\n' | sort | uniq -d` — 必须为空。

### 阶段 3：派发 Team Leader（并行）

每个 Leader 收到精确 prompt，包含：
- Issue 列表 + 每个 Issue 的具体修复方案
- 文件白名单（Worker 不得超出此范围）
- Worktree 名称
- Commit message 模板
- 验收命令

```python
# Leader prompt 模板
"""
You are Team Leader for {team_name}. Fix {N} issues ({batch_name}).

1. Create worktree: git worktree add .worktrees/{worktree_name} -b feat/{branch_name}
2. Read key source files: {file_list}
3. Spawn 4 Opus workers (Agent tool, mode="bypassPermissions", run_in_background=true)
   - Worker 1: {issue_list_1}
   - Worker 2: {issue_list_2}
   - Worker 3: {issue_list_3}
   - Worker 4: {issue_list_4}
4. Each worker: read → write failing test → implement fix → go test passes
5. Review all work, resolve conflicts, go test -race, commit
6. Push branch

IMPORTANT: Workers ONLY modify these files: {allowed_files}
"""
```

### 阶段 4：合并（逐支进行）

```bash
# 逐个合并，逐个测试
for branch in feat/team-auth feat/team-data feat/team-edge feat/team-validation feat/team-session; do
  git merge origin/$branch -m "merge: $branch → dev/delicious233"
  cd hub-server && go test ./... && cd ../edge-server && go test ./...
done
```

**冲突处理**：
- 导入冲突：保留双方 import
- 测试函数冲突：双方测试函数都保留
- 逻辑冲突：人工审查，优先安全修复

### 阶段 5：推送 + 清理

```bash
git push
# 删除临时 worktree
git worktree remove .worktrees/team-* --force
git worktree prune
# 删除已合并的 feat 分支
git branch -d feat/team-*
```

## Team Leader 规范

每个 Leader 必须：
1. **先建 worktree**，不污染主工作区
2. **先读源码**，理解当前实现再改
3. **Worker 文件边界硬约束**：超出白名单的修改直接拒绝
4. **先测试后代码**：每个 Issue 必须有失败测试再修复
5. **跑 race detector**：`go test -race ./... -count=1` 零 race
6. **自己审查**：Leader 在 commit 前 review 所有 Worker 的输出

## Worker 规范

每个 Worker 必须：
1. **只修改分配给自己的文件**：碰到需要改其他文件时，报告给 Leader 而不是自行扩大范围
2. **先写测试**：`_test.go` 文件中的失败测试 → 修代码 → 测试通过
3. **参考现有测试风格**：同一个包里的测试用什么 mock 框架、什么命名规范，保持一致
4. **commit 粒度**：每 1-2 个 Issue 一个 commit

## 实战案例：B1-B5 审计修复（2026-05-25）

```
输入：129 个 Issue，按 label 分组为 5 个批次
Team 数：5
每个 Team：1 Leader + 4 Workers = 5 Opus agents
总 agent 数：25
Worktree 数：5

文件隔离验证（零重叠）:
  Auth:    hub-server/middleware/, jwtutil/, service/auth.go
  Data:    hub-server/repository/, service/agent.go
  Edge:    edge-server/events/, api/handlers.go, store/
  Valid:   edge-server/api/ + hub-server/handler/, model/
  Session: hub-server/service/session.go, handler/session.go

结果：39 个 Issue 修复，2 处合并冲突（均为 import + test 追加），全绿测试。
```

## 与 dev-loop 的关系

| 维度 | dev-loop | dev-team |
|------|----------|----------|
| 适用场景 | 长程单线任务（跨天重构） | 大规模并行攻坚（批量 Issue） |
| 模型 | Subagent 流水线 | Team Leader + Worker 并行 |
| Worktree | 1 个 | N 个（每 Team 1 个） |
| 并发度 | 顺序为主，局部并行 | 全部并行 |
| 冲突风险 | 低（单线） | 中（需文件边界规划） |

两者可叠加：dev-team 完成批量修复后，dev-loop 接管长程迭代。

## 常见问题

**Q: 为什么不直接在 dev/delicious233 上开发？**
A: 多 Team 并行修改同一批文件时，频繁 commit/push 会互相阻塞。独立 worktree 让每个 Team 在自己的分支上自由 commit，最后统一合并。

**Q: 什么时候用 5 Team，什么时候用 2-3 Team？**
A: Issue 数 >20 且跨 4+ 模块时用 5 Team。10-20 个 Issue 用 3 Team。5-10 个 Issue 用 1-2 Team 或直接单 agent。

**Q: Worker 可以再派 subagent 吗？**
A: 不推荐。三层嵌套难以追踪。Worker 直接实现，不要当二级 Leader。

**Q: 合并时发生非 import 冲突怎么办？**
A: 说明文件边界规划有漏洞。Stop，分析冲突来源，手动解决后更新本 skill 的边界规划示例。
