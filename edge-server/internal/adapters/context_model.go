// CtxModelKey 的唯一权威定义在 internal/orchestration（与 CtxBudgetKey 同族，
// #2154 orchestrator 竞态修复）。本文件保留 alias，使既有调用点零改动；
// context key 的身份 = 类型 + 值，alias 保持二者一致。
package adapters

import "github.com/agenthub/edge-server/internal/orchestration"

// CtxModelKey is the context key for passing the per-run model override
// (string) through ParseStream call chains.
const CtxModelKey = orchestration.CtxModelKey
