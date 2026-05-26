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

// ParseBody reads only the markdown body (content after the closing "---"
// delimiter) from a SKILL.md file.
func ParseBody(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("skills: read %s: %w", path, err)
	}

	content := string(data)
	// Find the second "---" delimiter that closes the frontmatter.
	// The frontmatter starts at the first "---" on line 1.
	idx := strings.Index(content, "---")
	if idx != 0 {
		// Frontmatter may not start at column 0 (e.g. BOM). Find the first line.
		lines := strings.SplitN(content, "\n", 2)
		if len(lines) > 0 && strings.TrimSpace(lines[0]) == "---" {
			// Continue with the rest.
		} else {
			return "", fmt.Errorf("skills: missing frontmatter opening in %s", path)
		}
	}

	// Find the closing "---": search from after the first line.
	rest := content
	if idx == 0 {
		nl := strings.Index(rest, "\n")
		if nl < 0 {
			return "", fmt.Errorf("skills: malformed frontmatter in %s", path)
		}
		rest = rest[nl+1:]
	}

	endIdx := strings.Index(rest, "\n---")
	if endIdx < 0 {
		// Maybe there's no body at all.
		return "", nil
	}

	bodyStart := endIdx + 4 // skip "\n---"
	if bodyStart >= len(rest) {
		return "", nil
	}

	body := rest[bodyStart:]
	// Strip leading newline if present.
	body = strings.TrimPrefix(body, "\n")
	return body, nil
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
	if len(rawValue) >= 2 && rawValue[0] == '"' && rawValue[len(rawValue)-1] == '"' {
		value = rawValue[1 : len(rawValue)-1]
	} else if len(rawValue) >= 2 && rawValue[0] == '\'' && rawValue[len(rawValue)-1] == '\'' {
		value = rawValue[1 : len(rawValue)-1]
	} else {
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
				result = append(result, p)
			}
		}
		return result
	}
	return []string{value}
}

// ParseFull reads and parses the entire SKILL.md file at path into a Skill
// with both frontmatter and body populated.
func ParseFull(path string) (*Skill, error) {
	s, err := ParseFrontmatter(path)
	if err != nil {
		return nil, err
	}
	body, err := ParseBody(path)
	if err != nil {
		return nil, err
	}
	s.Body = body
	return s, nil
}
