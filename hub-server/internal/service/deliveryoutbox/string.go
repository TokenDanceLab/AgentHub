package deliveryoutbox

// TruncateString truncates s to maxLen characters, appending "..." if truncated.
// When maxLen < 3 and truncation is required, the result is clipped to maxLen
// without forcing an ellipsis (avoids a negative slice bound).
func TruncateString(s string, maxLen int) string {
	if maxLen < 0 {
		return ""
	}
	if len(s) <= maxLen {
		return s
	}
	if maxLen < 3 {
		return s[:maxLen]
	}
	return s[:maxLen-3] + "..."
}
