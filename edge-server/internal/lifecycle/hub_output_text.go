package lifecycle

import (
	"strings"
	"sync"
	"unicode/utf8"
)

const (
	hubCallbackFinalMaxBytes = 32 * 1024
	hubCallbackChunkMaxBytes = 16 * 1024
)

type hubOutputCollector struct {
	mu        sync.Mutex
	builder   strings.Builder
	fallback  string
	maxBytes  int
	truncated bool
}

func newHubOutputCollector(maxBytes int) *hubOutputCollector {
	if maxBytes <= 0 {
		maxBytes = hubCallbackFinalMaxBytes
	}
	return &hubOutputCollector{maxBytes: maxBytes}
}

func (c *hubOutputCollector) Append(text string) {
	if text == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.builder.Len() >= c.maxBytes {
		c.truncated = true
		return
	}
	remaining := c.maxBytes - c.builder.Len()
	if len(text) > remaining {
		text = strings.ToValidUTF8(text[:remaining], "")
		c.truncated = true
	}
	c.builder.WriteString(text)
}

func (c *hubOutputCollector) SetFallback(text string) {
	if text == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.fallback == "" {
		c.fallback = strings.TrimSpace(text)
	}
}

func (c *hubOutputCollector) Final() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	content := strings.TrimSpace(c.builder.String())
	if content == "" {
		content = c.fallback
	}
	if content == "" {
		return ""
	}
	if c.truncated {
		return content + "\n[output truncated]"
	}
	return content
}

func extractHubCallbackText(payload any) string {
	payloadMap, ok := payload.(map[string]any)
	if !ok {
		return ""
	}
	for _, key := range []string{"content", "text", "delta", "output", "result"} {
		if value, ok := payloadMap[key].(string); ok && value != "" {
			return value
		}
	}
	if message, ok := payloadMap["message"].(map[string]any); ok {
		for _, key := range []string{"content", "text"} {
			if value, ok := message[key].(string); ok && value != "" {
				return value
			}
		}
	}
	return ""
}

func splitHubCallbackText(text string, maxBytes int) []string {
	if text == "" {
		return nil
	}
	if maxBytes <= 0 || len(text) <= maxBytes {
		return []string{text}
	}
	chunks := make([]string, 0, len(text)/maxBytes+1)
	for len(text) > 0 {
		if len(text) <= maxBytes {
			chunks = append(chunks, text)
			break
		}
		cut := maxBytes
		for cut > 0 && !utf8.ValidString(text[:cut]) {
			cut--
		}
		if cut == 0 {
			_, size := utf8.DecodeRuneInString(text)
			if size <= 0 {
				size = 1
			}
			cut = size
		}
		chunks = append(chunks, text[:cut])
		text = text[cut:]
	}
	return chunks
}
