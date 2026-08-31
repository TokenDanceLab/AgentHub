package skills

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// ParseFrontmatter reads a SKILL.md file and extracts the YAML frontmatter
// (name, description, triggers) without reading the full body.
// This is the lightweight parse used during Discover.
func ParseFrontmatter(path string) (*Skill, error) {
	// #nosec G304 -- skill paths come from the configured skills dir (operator)
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("skills: open %s: %w", path, err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)

	// Expect first line to be "---" (frontmatter delimiter).
	if !scanner.Scan() {
		return nil, fmt.Errorf("skills: empty file %s", path)
	}
	if strings.TrimSpace(scanner.Text()) != "---" {
		return nil, fmt.Errorf("skills: missing frontmatter delimiter in %s", path)
	}

	var name, description string
	var triggers []string

	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "---" {
			break // end of frontmatter
		}
		key, value := parseFrontmatterLine(line)
		switch key {
		case "name":
			name = value
		case "description":
			description = value
		case "triggers":
			triggers = append(triggers, parseTriggersValue(value)...)
		}
	}

	if name == "" {
		return nil, fmt.Errorf("skills: missing 'name' in frontmatter of %s", path)
	}

	return &Skill{
		Name:        name,
		Description: description,
		Triggers:    triggers,
		Path:        path,
	}, nil
}

// parseFrontmatterLine parses a single "key: value" line from YAML frontmatter.
// Handles quoted strings and bare values.
func parseFrontmatterLine(line string) (key, value string) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return "", ""
	}

	// Not a key: value line (e.g. list item "- foo")
	if !strings.Contains(trimmed, ":") {
		return "", ""
	}

	colon := strings.Index(trimmed, ":")
	key = strings.TrimSpace(trimmed[:colon])
	if key == "" {
		return "", ""
	}

	rawValue := strings.TrimSpace(trimmed[colon+1:])
	if rawValue == "" {
		return key, ""
	}

	// Strip surrounding double quotes.
	switch {
	case len(rawValue) >= 2 && rawValue[0] == '"' && rawValue[len(rawValue)-1] == '"':
		value = rawValue[1 : len(rawValue)-1]
	case len(rawValue) >= 2 && rawValue[0] == '\'' && rawValue[len(rawValue)-1] == '\'':
		value = rawValue[1 : len(rawValue)-1]
	default:
		value = rawValue
	}

	return key, value
}

// parseTriggersValue parses the value of a "triggers" field.
// It handles comma-separated strings like "build, test, deploy"
// and also returns the value as a single element if it does not contain commas.
func parseTriggersValue(value string) []string {
	if value == "" {
		return nil
	}
	// If the value looks like a comma-separated list, split it.
	if strings.Contains(value, ",") {
		parts := strings.Split(value, ",")
		result := make([]string, 0, len(parts))
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p != "" {
				result = append(result, strings.ToLower(p))
			}
		}
		return result
	}
	return []string{strings.ToLower(value)}
}
