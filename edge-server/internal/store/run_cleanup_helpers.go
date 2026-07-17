package store

import "time"

func filterIDs(ids []string, keep func(string) bool) []string {
	filtered := ids[:0]
	for _, id := range ids {
		if keep(id) {
			filtered = append(filtered, id)
		}
	}
	return filtered
}

func isTerminalRunStatus(status string) bool {
	switch status {
	case "cancelled", "failed", "finished", "completed_with_issues":
		return true
	default:
		return false
	}
}

func runTerminalTime(run Run) (time.Time, bool) {
	if run.FinishedAt != "" {
		if t, err := time.Parse(time.RFC3339, run.FinishedAt); err == nil {
			return t, true
		}
	}
	if run.CreatedAt != "" {
		if t, err := time.Parse(time.RFC3339, run.CreatedAt); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
