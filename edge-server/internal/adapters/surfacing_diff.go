package adapters

import (
	"fmt"
	"strings"
)

// Residual pure-helper peel #1112: unified-diff generation helpers.

// generateUnifiedDiff produces a minimal unified diff between old and new content.
func generateUnifiedDiff(path, oldContent, newContent string) string {
	oldLines := splitLines(oldContent)
	newLines := splitLines(newContent)

	// Simple LCS-based diff: find common prefix and suffix, diff the middle.
	prefix := commonPrefixLen(oldLines, newLines)
	suffix := commonSuffixLen(oldLines[prefix:], newLines[prefix:])

	var buf strings.Builder
	fmt.Fprintf(&buf, "--- a/%s\n", path)
	fmt.Fprintf(&buf, "+++ b/%s\n", path)

	oldMiddle := oldLines[prefix : len(oldLines)-suffix]
	newMiddle := newLines[prefix : len(newLines)-suffix]

	if len(oldMiddle) == 0 && len(newMiddle) == 0 {
		return "" // no actual diff
	}

	// Determine context start line (1-indexed).
	startLine := prefix + 1
	fmt.Fprintf(&buf, "@@ -%d,%d +%d,%d @@\n",
		startLine, len(oldMiddle),
		startLine, len(newMiddle))

	for _, line := range oldMiddle {
		buf.WriteString("-")
		buf.WriteString(line)
		buf.WriteString("\n")
	}
	for _, line := range newMiddle {
		buf.WriteString("+")
		buf.WriteString(line)
		buf.WriteString("\n")
	}

	return buf.String()
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	lines := strings.SplitAfter(s, "\n")
	// Remove trailing empty from final newline.
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	// Strip the trailing newline from each line for clean output.
	for i, line := range lines {
		lines[i] = strings.TrimSuffix(line, "\n")
	}
	return lines
}

func commonPrefixLen(a, b []string) int {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		if a[i] != b[i] {
			return i
		}
	}
	return n
}

func commonSuffixLen(a, b []string) int {
	na, nb := len(a), len(b)
	n := na
	if nb < n {
		n = nb
	}
	for i := 0; i < n; i++ {
		if a[na-1-i] != b[nb-1-i] {
			return i
		}
	}
	return n
}

func countDiffLines(diff string, prefix byte) int {
	count := 0
	for _, line := range strings.Split(diff, "\n") {
		if len(line) > 0 && line[0] == prefix {
			count++
		}
	}
	return count
}
