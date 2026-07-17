package dispatch

// HistoryLoadIDs reports whether thread-history loaders have enough identity to
// query (session + trigger message). Empty either side short-circuits to nil.
func HistoryLoadIDs(sessionID, triggerMessageID string) bool {
	return sessionID != "" && triggerMessageID != ""
}

// ShouldLoadPinnedMessages reports whether pinned-context loaders should query.
func ShouldLoadPinnedMessages(sessionID string) bool {
	return sessionID != ""
}

// ShouldResolveTeamContext reports whether team-run attribution should be
// resolved for an agent instance (requires custom-agent binding).
func ShouldResolveTeamContext(customAgentID *string) bool {
	return HasCustomAgentBinding(customAgentID)
}

// TeamContextFromRun is true when a team-run row is usable for attribution.
func TeamContextFromRun(teamRunID string) bool {
	return teamRunID != ""
}
