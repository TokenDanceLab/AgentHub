// Package adapters — ACP→Edge 事件词汇锁测试（#1404 Phase 2 前置）。
//
// 本文件确保 acp_events.go 中的 ACP→Edge 翻译表引用的 run.agent.* 事件类型
// 与 adapter.go 中定义的 BusEvent* 常量一一对应，防止实现时发生词汇漂移。
// 当 ACP 映射增加新事件类型或 adapter.go 中常量发生变化时，本测试会报错，
// 迫使开发者显式更新此规范表——从而实现 §3 映射的 SSOT 一致性。
//
// 参考：docs/analysis/acp-spike-phase1.md §3（翻译映射）
//       api/events.md §3.3（live-streaming 事件表）
package adapters

import (
	"encoding/json"
	"strings"
	"testing"
)

// acpEdgeMapEntry 描述一条 ACP 事件类型到 Edge run.agent.* 事件的一一对应。
// 每条 Entry 必须对应到 adapter.go 中已定义的 BusEvent* 常量。
type acpEdgeMapEntry struct {
	// acpType 是 ACP session/update 事件的 type 字段值，
	// 例如 "AgentMessageChunk"、"ToolCall" 等。
	acpType string

	// edgeEvents 列出该 ACP 事件应映射到的 Edge 事件常量，
	// 顺序与 mapACPUpdate 或 mapACPPromptResult 输出一致。
	edgeEvents []string

	// mapped 表示该 ACP 类型是否已被映射。
	// Phase 2 前，Plan / SessionInfoUpdate / ToolCallUpdate 为 false。
	mapped bool
}

// acpVocabularyLock 是 ACP→Edge 事件映射的规范表。此处定义的每一项
// 必须与 acp_events.go 中的实际实现一致。任何对映射逻辑或事件常量的
// 修改都要求同步更新本表，否则测试失败，从而锁住词汇表。
func acpVocabularyLock() []acpEdgeMapEntry {
	return []acpEdgeMapEntry{
		// ------ 已映射 (Phase 2 prep) ------
		{
			acpType:    "AgentMessageChunk",
			edgeEvents: []string{BusEventTextDelta},
			mapped:     true,
		},
		{
			acpType:    "AgentThoughtChunk",
			edgeEvents: []string{BusEventThinking},
			mapped:     true,
		},
		{
			acpType:    "ToolCall",
			edgeEvents: []string{BusEventToolCall, BusEventToolResult},
			mapped:     true,
		},
		{
			acpType:    "UsageUpdate",
			edgeEvents: []string{BusEventContextUsage},
			mapped:     true,
		},

		// ------ 有意未映射（Phase 2 设计审批前挂起）------
		{
			acpType:    "Plan",
			edgeEvents: nil,
			mapped:     false,
		},
		{
			acpType:    "SessionInfoUpdate",
			edgeEvents: nil,
			mapped:     false,
		},
		{
			acpType:    "ToolCallUpdate",
			edgeEvents: nil,
			mapped:     false,
		},

		// ------ 非 session/update 通道：session/prompt 响应 ------
		// mapACPPromptResult 使用 BusEventResult 发出 stop_reason。
		{
			acpType:    "PromptResult",
			edgeEvents: []string{BusEventResult},
			mapped:     true,
		},
	}
}

// TestACPVocabularyLock 验证 ACP→Edge 映射表中引用的所有 run.agent.* 事件
// 均为 adapter.go 中定义的、以 "run.agent." 为前缀的合法常量，且映射行
// 为与声明的规范表一致。任何驱动事件映射或常量定义的更改都应导致本测试
// 失败，需要手动更新规范表——这就是"词汇锁"。
func TestACPVocabularyLock(t *testing.T) {
	entries := acpVocabularyLock()

	// ----- 阶段 1：常量存在性与前缀校验 -----
	for _, e := range entries {
		for _, ev := range e.edgeEvents {
			// 每个常量必须非空。
			if ev == "" {
				t.Errorf("ACP %q: edge event constant is empty", e.acpType)
				continue
			}
			// 每个常量必须以 run.agent. 开头（与 adapter.go 定义一致）。
			if !strings.HasPrefix(ev, "run.agent.") {
				t.Errorf("ACP %q: edge event %q does not start with run.agent.", e.acpType, ev)
			}
			// 常量值不应与自身键名相同（即必须是编译时常量而非字符串字面量）。
			// 这里不做反射，而通过后续阶段 2 的实际映射结果与常量比较来验证。
		}
	}

	// ----- 阶段 2：运行时行为与规范表对齐 -----
	// 遍历规范表中的每个 ACP 事件类型，构造最小输入调用 mapACPUpdate，
	// 验证输出事件的类型和数量与规范表完全一致。

	for _, e := range entries {
		// PromptResult 单独处理（非 session/update 通道）
		if e.acpType == "PromptResult" {
			verifyPromptResultMapping(t, e)
			continue
		}

		input := buildACPInput(e.acpType)
		got := mapACPUpdate(input)

		if !e.mapped {
			// 有意未映射的类型应返回 nil。
			if len(got) != 0 {
				t.Errorf("ACP %q: intentionally unmapped but mapACPUpdate returned %d events: %+v",
					e.acpType, len(got), got)
			}
			continue
		}

		// 已映射的类型：输出事件数量必须与规范表一致。
		if len(got) != len(e.edgeEvents) {
			// ToolCall 只有 completed 时才是 1:2 映射；running 时只发 tool_call。
			// 阶段 3 覆盖 running 场景；阶段 2 仅验证 completed 场景。
			t.Errorf("ACP %q: expected %d edge events, got %d (events=%+v)",
				e.acpType, len(e.edgeEvents), len(got), got)
			continue
		}

		for i, ev := range got {
			if ev.EventType != e.edgeEvents[i] {
				t.Errorf("ACP %q event[%d]: got %q, want %q",
					e.acpType, i, ev.EventType, e.edgeEvents[i])
			}
		}
	}

	// ----- 阶段 3：ToolCall running 只发 tool_call，不发 tool_result -----
	// 这是词汇锁的关键边界：不能因为规范表写了两个 event 就假定所有状态都发两个。
	gotRunning := mapACPUpdate(acpSessionUpdateEvent{
		Type:       "ToolCall",
		ToolCallID: "tc_vocab",
		Status:     "running",
	})
	if len(gotRunning) != 1 || gotRunning[0].EventType != BusEventToolCall {
		t.Errorf("ToolCall running: expected [tool_call], got %+v", gotRunning)
	}
}

// buildACPInput 为给定的 ACP 类型构造最小的合法输入值，使 mapACPUpdate
// 能被调用并返回合理数量的映射事件。
func buildACPInput(acpType string) acpSessionUpdateEvent {
	switch acpType {
	case "AgentMessageChunk", "AgentThoughtChunk":
		return acpSessionUpdateEvent{
			Type: acpType,
			Content: []acpContentPart{
				{Type: "text", Text: "vocab-lock"},
			},
		}
	case "ToolCall":
		return acpSessionUpdateEvent{
			Type:       acpType,
			ToolCallID: "tc_vocab",
			Title:      "vocab-lock tool",
			Kind:       "function",
			Status:     "completed",
			RawOutput:  json.RawMessage(`{"ok":true}`),
		}
	case "UsageUpdate":
		return acpSessionUpdateEvent{
			Type:        acpType,
			UsageInput:  10,
			UsageOutput: 20,
		}
	default:
		// Plan / SessionInfoUpdate / ToolCallUpdate / unknown
		return acpSessionUpdateEvent{Type: acpType}
	}
}

// verifyPromptResultMapping 验证 session/prompt 响应的映射。
func verifyPromptResultMapping(t *testing.T, e acpEdgeMapEntry) {
	t.Helper()
	got := mapACPPromptResult(json.RawMessage(`{"stopReason":"end_turn"}`))
	if got == nil {
		t.Fatalf("PromptResult: expected non-nil mappedEvent, got nil")
	}
	if got.EventType != BusEventResult {
		t.Errorf("PromptResult: got %q, want %q", got.EventType, BusEventResult)
	}
	if len(e.edgeEvents) != 1 || e.edgeEvents[0] != BusEventResult {
		t.Errorf("PromptResult: vocabulary table entry inconsistent (events=%v)", e.edgeEvents)
	}
}
