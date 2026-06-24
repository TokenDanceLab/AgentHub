# CI 修复计划

> 日期：2026-06-24
> 分析依据：`docs/analysis/ci-remediation-analysis.md`

## 任务分解

### T1: Go unparam 修复
- **文件**：4 个 Go 文件
- **改动**：参数 `_` 前缀 + `applyHunkToContent` 移除 error 返回
- **验证**：`cd edge-server && go build ./... && golangci-lint run --disable-all --enable unparam ./...`
- **Commit**：`fix(edge): resolve 4 unparam lint issues`

### T2: Frontend web lint 修复
- **文件**：`app/web/src/stores/wsEventBridge.ts`（可能 + 1 个 runId 文件）
- **改动**：删除 3 个未使用 import + 3 个未使用变量用 `_` 前缀
- **验证**：`cd app && pnpm --filter "./web" lint`
- **Commit**：`fix(web): resolve 6 unused-vars lint errors`

### T3: Frontend desktop lint 修复
- **文件**：`app/desktop/src/views/TeamRunConsole.tsx` + `app/desktop/src/utils/threadTitle.ts`
- **改动**：删除 7 个未使用 import + 修复 `\[` 转义
- **验证**：`cd app && pnpm --filter "./desktop" lint`
- **Commit**：`fix(desktop): resolve 8 lint errors (unused-vars + escape)`

### T4: 推送 + CI 验证
- Push dev → 等 CI → 确认 lint 相关步骤全绿
- **注意**：coverage 仍会失败（已批准跳过）

## 依赖图

```
T1 (Go) ──┐
T2 (Web) ──┤ 无依赖，可并行
T3 (Desktop) ┘
     │
     ▼
   T4 (Push + CI)
```

## 执行顺序

3 个任务互不依赖（不同语言/文件），可并行执行。
全部完成后一次性 commit + push。
