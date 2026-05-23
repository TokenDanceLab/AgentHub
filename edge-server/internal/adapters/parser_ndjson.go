package adapters

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

// NDJSONStreamParser parses Claude Code's --output-format stream-json protocol.
// Each line is a complete JSON object. Lines that fail to parse are silently
// skipped (they go to stderr in Claude Code via the stdout guard).
type NDJSONStreamParser struct {
	emitter EventEmitter
	run     store.Run
	seq     int64
}

// NewNDJSONStreamParser creates a parser that emits events via the given emitter.
func NewNDJSONStreamParser(emitter EventEmitter, run store.Run) *NDJSONStreamParser {
	return &NDJSONStreamParser{emitter: emitter, run: run, seq: 0}
}

// Parse reads NDJSON from r until EOF or ctx cancellation.
func (p *NDJSONStreamParser) Parse(ctx context.Context, r io.Reader) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 256*1024), 10*1024*1024) // 10MB max line

	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		p.seq++
		p.parseLine(line)
	}
	return scanner.Err()
}

func (p *NDJSONStreamParser) parseLine(line []byte) {
	var msg claudeSDKMessage
	if err := json.Unmarshal(line, &msg); err != nil {
		// Non-JSON lines go to stderr; skip silently (stdout guard behavior)
		return
	}

	scope := map[string]any{
		"projectId": p.run.ProjectID,
		"threadId":  p.run.ThreadID,
		"runId":     p.run.ID,
	}
	now := time.Now().UnixMilli()

	switch msg.Type {
	case "system":
		switch msg.Subtype {
		case "init":
			p.emitSessionInit(scope, &msg)
		default:
			slog.Debug("ndjson: unhandled system subtype", "subtype", msg.Subtype)
		}

	case "assistant":
		p.parseAssistantMessage(scope, &msg)

	case "stream_event":
		p.parseStreamEvent(scope, &msg)

	case "user":
		// user messages in the stream are tool_result deliveries
		p.emitToolResult(scope, &msg)

	case "result":
		p.parseResult(scope, &msg)

	case "tool_progress":
		// Emitted as a status update
		p.emit(scope, BusEventToolCall, map[string]any{
			"status":  "in_progress",
			"elapsed": msg.ElapsedSeconds,
		})

	default:
		slog.Debug("ndjson: unhandled message type", "type", msg.Type)
		_ = now
	}
}

func (p *NDJSONStreamParser) parseAssistantMessage(scope map[string]any, msg *claudeSDKMessage) {
	if msg.Message == nil {
		return
	}
	for _, block := range msg.Message.Content {
		switch block.Type {
		case "text":
			p.emit(scope, BusEventTextBlock, map[string]any{
				"content": block.Text,
			})
		case "tool_use":
			p.emit(scope, BusEventToolCall, map[string]any{
				"callId":   block.ID,
				"toolName": block.Name,
				"input":    block.Input,
				"status":   "pending",
			})
		case "thinking":
			p.emit(scope, BusEventThinking, map[string]any{
				"content": block.Thinking,
			})
		}
	}
}

func (p *NDJSONStreamParser) parseStreamEvent(scope map[string]any, msg *claudeSDKMessage) {
	if msg.Event == nil {
		return
	}
	switch msg.Event.Type {
	case "content_block_delta":
		switch msg.Event.Delta.Type {
		case "text_delta":
			p.emit(scope, BusEventTextDelta, map[string]any{
				"content": msg.Event.Delta.Text,
			})
		case "thinking_delta":
			p.emit(scope, BusEventThinking, map[string]any{
				"content": msg.Event.Delta.Thinking,
			})
		}
	case "content_block_start":
		if msg.Event.ContentBlock != nil && msg.Event.ContentBlock.Type == "tool_use" {
			p.emit(scope, BusEventToolCall, map[string]any{
				"callId":   msg.Event.ContentBlock.ID,
				"toolName": msg.Event.ContentBlock.Name,
				"input":    msg.Event.ContentBlock.Input,
				"status":   "started",
			})
		}
	case "content_block_stop":
		// End of a content block — no additional info needed
	}
}

func (p *NDJSONStreamParser) parseResult(scope map[string]any, msg *claudeSDKMessage) {
	success := msg.Subtype == "success"
	payload := map[string]any{
		"success":  success,
		"duration": msg.DurationMs,
		"turns":    msg.NumTurns,
	}
	if msg.Usage != nil {
		payload["usage"] = map[string]any{
			"inputTokens":  msg.Usage.InputTokens,
			"outputTokens": msg.Usage.OutputTokens,
		}
	}
	if !success {
		payload["errors"] = msg.Errors
	}
	p.emit(scope, BusEventResult, payload)
}

func (p *NDJSONStreamParser) emitSessionInit(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventSessionInit, map[string]any{
		"model":          msg.Model,
		"tools":          msg.Tools,
		"mcpServers":     msg.MCPServers,
		"permissionMode": msg.PermissionMode,
		"version":        msg.Version,
	})
}

func (p *NDJSONStreamParser) emitToolResult(scope map[string]any, msg *claudeSDKMessage) {
	if msg.Message == nil {
		return
	}
	for _, block := range msg.Message.Content {
		if block.Type == "tool_result" {
			p.emit(scope, BusEventToolResult, map[string]any{
				"callId":   block.ToolUseID,
				"content":  block.Content,
				"isError":  block.IsError,
			})
		}
	}
}

func (p *NDJSONStreamParser) emit(scope map[string]any, eventType string, payload map[string]any) {
	p.emitter.Emit(eventType, scope, payload)
}

// --- Claude SDK message schemas (subset used for parsing) ---

type claudeSDKMessage struct {
	Type           string               `json:"type"`
	Subtype        string               `json:"subtype,omitempty"`
	Message        *claudeContentMessage `json:"message,omitempty"`
	Event          *claudeStreamEvent    `json:"event,omitempty"`
	Model          string               `json:"model,omitempty"`
	Tools          []string             `json:"tools,omitempty"`
	MCPServers     []any                `json:"mcp_servers,omitempty"`
	PermissionMode string               `json:"permissionMode,omitempty"`
	Version        string               `json:"version,omitempty"`
	DurationMs     int64                `json:"duration_ms,omitempty"`
	NumTurns       int                  `json:"num_turns,omitempty"`
	ElapsedSeconds float64              `json:"elapsed_time_seconds,omitempty"`
	Usage          *claudeUsage         `json:"usage,omitempty"`
	Errors         []string             `json:"errors,omitempty"`
}

type claudeContentMessage struct {
	Role    string            `json:"role"`
	Content []claudeContentBlock `json:"content"`
}

type claudeContentBlock struct {
	Type      string `json:"type"`
	Text      string `json:"text,omitempty"`
	Thinking  string `json:"thinking,omitempty"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Input     any    `json:"input,omitempty"`
	ToolUseID string `json:"tool_use_id,omitempty"`
	Content   string `json:"content,omitempty"`
	IsError   bool   `json:"is_error,omitempty"`
}

type claudeStreamEvent struct {
	Type         string                `json:"type"`
	Delta        *claudeDelta          `json:"delta,omitempty"`
	ContentBlock *claudeContentBlock   `json:"content_block,omitempty"`
}

type claudeDelta struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Thinking string `json:"thinking,omitempty"`
}

type claudeUsage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
}
