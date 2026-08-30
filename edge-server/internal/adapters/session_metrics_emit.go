package adapters

// SessionMetricsPayload builds the BusEventSessionMetrics payload from a
// result message. Returns (payload, true) when at least one metric field is
// non-zero; (nil, false) otherwise so callers can skip the emit cheaply.
func SessionMetricsPayload(msg *claudeSDKMessage) (map[string]any, bool) {
	if msg == nil {
		return nil, false
	}
	payload := map[string]any{}
	has := false
	if msg.Usage != nil {
		if msg.Usage.InputTokens > 0 {
			payload["inputTokens"] = msg.Usage.InputTokens
			has = true
		}
		if msg.Usage.OutputTokens > 0 {
			payload["outputTokens"] = msg.Usage.OutputTokens
			has = true
		}
	}
	if msg.TotalCostUSD > 0 {
		payload["totalCostUsd"] = msg.TotalCostUSD
		has = true
	}
	if msg.Model != "" {
		payload["model"] = msg.Model
	}
	if !has {
		return nil, false
	}
	return payload, true
}
