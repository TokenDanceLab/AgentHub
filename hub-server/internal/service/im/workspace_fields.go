package im

import (
	"fmt"
	"strings"
)

// NormalizeRequiredName trims and requires a non-empty label for workspace /
// project-thread names. Callers map the error to domain errcodes.
func NormalizeRequiredName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("name is required")
	}
	return name, nil
}

// NormalizeOptionalText trims optional free-text fields such as descriptions.
func NormalizeOptionalText(text string) string {
	return strings.TrimSpace(text)
}
