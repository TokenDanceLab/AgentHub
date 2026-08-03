// CtxBudgetKey 的唯一权威定义已迁移到 internal/orchestration（A-V1 Step 2,
// #1566）。本文件保留 alias，使既有调用点（parser_ndjson、codex、opencode、
// lifecycle）零改动；context key 的身份 = 类型 + 值，alias 保持二者一致。
package adapters

import "github.com/agenthub/edge-server/internal/orchestration"

// CtxBudgetKey is the context key for passing a *runnerctx.ContextBudget
// through ParseStream call chains.
const CtxBudgetKey = orchestration.CtxBudgetKey
