// Contract aliases for package acp（#1760 acp 增量）。
//
// 合同类型与 BusEvent* 常量的唯一权威（SSOT）在 internal/orchestration；
// 本文件与 adapters 根包的 contract_aliases.go、兄弟叶子包 adapters/sdk 与
// adapters/claude 的 aliases.go 采用同一模式：派生 alias / 常量，不复制
// 定义，使归组后的实现文件与测试继续免限定引用合同词汇。
package acp

import "github.com/agenthub/edge-server/internal/orchestration"

// ── Contract type aliases (single SSOT: internal/orchestration) ─────────────

type EventEmitter = orchestration.EventEmitter
type AdapterMetadata = orchestration.AdapterMetadata
type AgentCapabilities = orchestration.AgentCapabilities
type RunProcessContext = orchestration.RunProcessContext
type AgentAdapter = orchestration.AgentAdapter

// ── Bus event type strings（与 orchestration 完全一致，防双 SSOT）────────────
const (
	BusEventTextDelta           = orchestration.BusEventTextDelta
	BusEventThinking            = orchestration.BusEventThinking
	BusEventToolCall            = orchestration.BusEventToolCall
	BusEventToolResult          = orchestration.BusEventToolResult
	BusEventContextUsage        = orchestration.BusEventContextUsage
	BusEventResult              = orchestration.BusEventResult
	BusEventStatusChange        = orchestration.BusEventStatusChange
	BusEventPermissionRequested = orchestration.BusEventPermissionRequested
	BusEventPermissionDecided   = orchestration.BusEventPermissionDecided
)
