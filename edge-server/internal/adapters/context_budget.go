package adapters

// CtxBudgetKey is the context key for passing a *runnerctx.ContextBudget
// through context to stream parsers so they can track token consumption.
const CtxBudgetKey ctxKey = "agenthub-budget"
