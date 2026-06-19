# AgentHub Workflow 标准化规范

> 2026-06-19 | 所有后续 Workflow 必须遵守此模板

## 强制五阶段

每个 Workflow 必须包含以下 5 个 phase，缺一不可：

```
1. Execute     执行实际开发任务
2. Self-Test   开发者自测（go test / pnpm test / bash -n）
3. Gate        门禁检查（对照 acceptance criteria 逐项验证）
4. Cross-Review 交叉审查（独立 agent 审查 diff，找 bug/风格/安全/完整度问题）
5. VERIFY      最终验证（build + 全量测试 + diff check + UI freeze check）
```

## 各阶段要求

### 1. Execute
- 明确任务范围（哪些文件可改、哪些不可改）
- 标注约束（UI freeze、no secrets、Chinese docs 等）
- 输出：代码变更

### 2. Self-Test
- Go 代码：`go build ./... && go test ./... -short -count=1`
- 前端代码：`pnpm typecheck && pnpm test`
- Shell 脚本：`bash -n`
- YAML/JSON：语法校验
- 输出：测试结果（pass/fail 列表）

### 3. Gate
- 逐项对照 acceptance criteria 检查
- 检查是否有意外修改（git diff --stat 验证只改了预期文件）
- 检查隐私红线（无 live host、无 secret、无敏感路径）
- 输出：门禁通过/阻塞，阻塞项列表

### 4. Cross-Review
- 独立 agent，只读审查
- 4 维审查：正确性 / 代码风格 / 安全性 / 完整度
- 输出：审查发现（file:line 引用）

### 5. VERIFY
- 全量 build + test（hub + edge + frontend）
- git diff --check（空白/冲突检查）
- UI freeze check（组件文件未修改）
- 输出：全部通过或阻塞项列表

## 反模式（禁止）

- ❌ 只有 Execute 没有 VERIFY 的 Workflow
- ❌ Execute agent 自己验收自己（必须独立 agent 审查）
- ❌ 跳过 Gate 直接 commit
- ❌ Cross-Review 只在最后做（应该在 self-test 之后、VERIFY 之前）
