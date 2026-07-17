package lifecycle

import "strings"

// stderrLogLines splits raw stderr text into non-empty log lines with CR stripped.
// Used so CC failure diagnostics are visible in Edge server logs.
func stderrLogLines(text string) []string {
	if text == "" {
		return nil
	}
	parts := strings.Split(text, "\n")
	var lines []string
	for _, line := range parts {
		line = strings.TrimRight(line, "\r")
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}
