package dispatch

// HistoryLoadIDs reports whether thread-history loaders have enough identity to
// query (session + trigger message). Empty either side short-circuits to nil.
func HistoryLoadIDs(sessionID, triggerMessageID string) bool {
	return sessionID != "" && triggerMessageID != ""
}

// HistoryTriggerMessageLoadable is true when the trigger message row is usable
// for seq-based history windowing.
func HistoryTriggerMessageLoadable(err error, msgPresent bool) bool {
	return err == nil && msgPresent
}

// HistoryMessagesPresent is true when a history query returned rows.
func HistoryMessagesPresent(err error, count int) bool {
	return err == nil && count > 0
}

// ShouldLoadPinnedMessages reports whether pinned-context loaders should query.
func ShouldLoadPinnedMessages(sessionID string) bool {
	return sessionID != ""
}

// PinnedRowsPresent is true when a pin listing returned rows.
func PinnedRowsPresent(err error, count int) bool {
	return err == nil && count > 0
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
