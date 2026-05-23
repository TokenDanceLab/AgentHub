// Package runnerctx provides shared types for passing run-level context
// between the API handler, lifecycle executor, and agent adapters.
package runnerctx

import "math"

// SessionMetrics holds aggregate context and cost metrics for a session,
// mirroring OpenCode's session usage tracking model.
type SessionMetrics struct {
	Context ContextMetrics `json:"context"`
	Cost    CostMetrics    `json:"cost"`
}

// ContextMetrics tracks token usage and context window consumption
// during a single session (or run).
type ContextMetrics struct {
	Total      int64   `json:"total"`
	Input      int64   `json:"input"`
	Output     int64   `json:"output"`
	Reasoning  int64   `json:"reasoning"`
	CacheRead  int64   `json:"cacheRead"`
	CacheWrite int64   `json:"cacheWrite"`
	Limit      int64   `json:"limit"`
	Usage      float64 `json:"usage"` // percentage of context window used
	Message    struct {
		ID   string `json:"id"`
		Time int64  `json:"time"`
	} `json:"message"`
}

// CostMetrics records the estimated cost and provider/model info for a session.
type CostMetrics struct {
	TotalCostUSD  float64 `json:"totalCostUsd"`
	ModelLabel    string  `json:"modelLabel"`
	ProviderLabel string  `json:"providerLabel"`
}

// EstimateTokens implements OpenCode's char/4 formula for estimating token count
// from raw character length. This is a rough heuristic used when actual token
// counts are unavailable from the API.
func EstimateTokens(chars int) int {
	return int(math.Ceil(float64(chars) / 4))
}
