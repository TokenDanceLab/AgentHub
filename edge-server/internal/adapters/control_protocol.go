package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
)

// ControlHandler receives control messages from the CLI's stdout and can respond on stdin.
// It is called by the NDJSON parser when it encounters control_request messages.
type ControlHandler interface {
	// HandleControlRequest is called when the CLI sends a control_request on stdout.
	// The handler can write a response to stdin via the provided writer.
	HandleControlRequest(ctx context.Context, stdin io.Writer, msg ControlMessage) error
}

// ControlMessage represents a control_request or control_response on stdout.
type ControlMessage struct {
	Type      string          `json:"type"` // "control_request", "control_response", "control_cancel_request"
	RequestID string          `json:"request_id,omitempty"`
	Request   json.RawMessage `json:"request,omitempty"`
	Response  json.RawMessage `json:"response,omitempty"`
}

// ControlRequestInner is the inner request payload.
type ControlRequestInner struct {
	Subtype               string `json:"subtype"`
	ToolName              string `json:"tool_name,omitempty"`
	Input                 any    `json:"input,omitempty"`
	ToolUseID             string `json:"tool_use_id,omitempty"`
	PermissionSuggestions []any  `json:"permission_suggestions,omitempty"`
	AgentID               string `json:"agent_id,omitempty"`
	Description           string `json:"description,omitempty"`
	TaskID                string `json:"task_id,omitempty"`
	Mode                  string `json:"mode,omitempty"`
	Model                 string `json:"model,omitempty"`
	MaxThinkingTokens     *int   `json:"max_thinking_tokens,omitempty"`
}

// ControlResponseInner is the response to a control_request.
type ControlResponseInner struct {
	Subtype            string `json:"subtype"`
	RequestID          string `json:"request_id,omitempty"`
	Behavior           string `json:"behavior,omitempty"` // "allow", "deny"
	UpdatedInput       any    `json:"updatedInput,omitempty"`
	Message            string `json:"message,omitempty"`
	Interrupt          bool   `json:"interrupt,omitempty"`
	ToolUseID          string `json:"toolUseID,omitempty"`
	DecisionClass      string `json:"decisionClassification,omitempty"`
	UpdatedPermissions []any  `json:"updatedPermissions,omitempty"`
	Error              string `json:"error,omitempty"`
}

// PermissionRequest carries a can_use_tool request from the CLI.
type PermissionRequest struct {
	RequestID string
	ToolName  string
	ToolUseID string
	Input     any
}

// PermissionScope binds a CLI permission request to the Edge run that owns it.
type PermissionScope struct {
	ProjectID string
	ThreadID  string
	RunID     string
}

// PendingPermissionRequest records a permission request waiting for a Desktop
// or Hub control decision.
type PendingPermissionRequest struct {
	ProjectID string
	ThreadID  string
	RunID     string
	RequestID string
	ToolName  string
	ToolUseID string
	Input     any
}

// PermissionDecision is the response to a permission request.
type PermissionDecision struct {
	Behavior      string // "allow" or "deny"
	UpdatedInput  any    // modified tool input (optional)
	Message       string // explanation for deny
	DecisionClass string // optional classification (e.g. "user_approved")
}

// PermissionDecider is a callback invoked when the CLI requests tool permission.
// The handler blocks until the decider returns a decision, then writes the
// control_response back to the CLI. This enables bridging to Desktop's approval UI.
//
// When decider is nil, the DefaultPermissionHandler falls back to auto-approve.
type PermissionDecider func(ctx context.Context, req PermissionRequest) PermissionDecision

// DefaultPermissionHandler auto-approves all tool use (bypassPermissions equivalent).
// For production use, supply a PermissionDecider via NewBridgedPermissionHandler
// to bridge to Desktop's approval UI.
type DefaultPermissionHandler struct {
	emitter EventEmitter              // nil = silent auto-approve; non-nil = emit permission events
	decider PermissionDecider         // nil = auto-approve all; non-nil = block until decision
	broker  *PermissionDecisionBroker // nil = no Hub/Desktop decision bridge
	scope   PermissionScope           // run scope for brokered requests
}

func (h *DefaultPermissionHandler) HandleControlRequest(ctx context.Context, stdin io.Writer, msg ControlMessage) error {
	var inner ControlRequestInner
	if err := json.Unmarshal(msg.Request, &inner); err != nil {
		return fmt.Errorf("parse control request: %w", err)
	}

	switch inner.Subtype {
	case "can_use_tool":
		return h.handleCanUseTool(ctx, stdin, msg.RequestID, &inner)
	case "initialize":
		// CLI requesting session init — acknowledge
		return nil
	case "get_context_usage":
		return h.handleGetContextUsage(ctx, stdin, msg.RequestID, &inner)
	case "mcp_status":
		return h.handleMCPStatus(ctx, stdin, msg.RequestID, &inner)
	case "mcp_set_servers":
		return h.handleMCPSetServers(ctx, stdin, msg.RequestID, &inner)
	case "get_settings":
		return h.handleGetSettings(ctx, stdin, msg.RequestID, &inner)
	case "apply_flag_settings":
		return h.handleApplyFlagSettings(ctx, stdin, msg.RequestID, &inner)
	case "hook_callback":
		return h.handleHookCallback(ctx, stdin, msg.RequestID, &inner)
	default:
		slog.Debug("control: unhandled request subtype", "subtype", inner.Subtype)
		return nil
	}
}

func (h *DefaultPermissionHandler) handleCanUseTool(ctx context.Context, stdin io.Writer, requestID string, inner *ControlRequestInner) error {
	// Compute base risk level for the event payload (no blocked-pattern scan here —
	// the SecurityHook pierces on PreToolUse before we reach this handler).
	riskLevel := ClassifyToolRisk(inner.ToolName)
	req := PermissionRequest{
		RequestID: requestID,
		ToolName:  inner.ToolName,
		ToolUseID: inner.ToolUseID,
		Input:     inner.Input,
	}

	var waitForBrokerDecision func(context.Context) PermissionDecision
	brokerRegisterFailed := false
	if h.broker != nil {
		if wait, ok := h.broker.Begin(h.scope, req); ok {
			waitForBrokerDecision = wait
		} else {
			brokerRegisterFailed = true
		}
	}

	// Emit permission_requested so Desktop can display approval UI
	if h.emitter != nil {
		h.emitter.Emit("run.agent.permission_requested", nil, map[string]any{
			"requestId": requestID,
			"toolName":  inner.ToolName,
			"toolUseId": inner.ToolUseID,
			"input":     inner.Input,
			"riskLevel": string(riskLevel),
		})
	}

	// Wait for decision: if a decider is configured, block until Desktop responds.
	// Otherwise fall back to auto-approve.
	var decision PermissionDecision
	switch {
	case waitForBrokerDecision != nil:
		decision = waitForBrokerDecision(ctx)
	case brokerRegisterFailed:
		decision = PermissionDecision{
			Behavior: "deny",
			Message:  "permission request could not be registered for approval",
		}
	case h.decider != nil:
		decision = h.decider(ctx, req)
	default:
		decision = PermissionDecision{Behavior: "allow"}
	}
	decision = NormalizePermissionDecision(decision)

	resp := ControlMessage{
		Type:      "control_response",
		RequestID: requestID,
	}
	innerResp := ControlResponseInner{
		Subtype:       "success",
		RequestID:     requestID,
		Behavior:      decision.Behavior,
		ToolUseID:     inner.ToolUseID,
		UpdatedInput:  decision.UpdatedInput,
		Message:       decision.Message,
		DecisionClass: decision.DecisionClass,
	}
	raw, err := json.Marshal(innerResp)
	if err != nil {
		return err
	}
	resp.Response = raw

	data, err := json.Marshal(resp)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if _, err := stdin.Write(data); err != nil {
		return fmt.Errorf("write control_response: %w", err)
	}

	// Emit permission_decided after decision
	if h.emitter != nil {
		h.emitter.Emit("run.agent.permission_decided", nil, map[string]any{
			"requestId": requestID,
			"toolName":  inner.ToolName,
			"toolUseId": inner.ToolUseID,
			"decision":  decision.Behavior,
		})
	}

	slog.Debug("control: permission decided", "tool", inner.ToolName, "toolUseId", inner.ToolUseID, "decision", decision.Behavior)
	return nil
}

// NewEventEmittingPermissionHandler creates a handler that emits permission events
// to the EventEmitter while auto-approving all tools (no decider = auto-approve).
// This allows Desktop to observe permission activity without blocking execution.
func NewEventEmittingPermissionHandler(emitter EventEmitter) *DefaultPermissionHandler {
	return &DefaultPermissionHandler{emitter: emitter}
}

// NewBridgedPermissionHandler creates a handler that blocks on the provided
// PermissionDecider for each can_use_tool request. Desktop should bridge the
// approval UI through the decider callback. The emitter is used to publish
// permission_requested/permission_decided events for observability.
func NewBridgedPermissionHandler(emitter EventEmitter, decider PermissionDecider) *DefaultPermissionHandler {
	return &DefaultPermissionHandler{emitter: emitter, decider: decider}
}

// NewBrokeredPermissionHandler creates a handler that registers permission
// requests before emitting permission_requested and then blocks until the
// shared broker receives a matching decision.
func NewBrokeredPermissionHandler(emitter EventEmitter, broker *PermissionDecisionBroker, scope PermissionScope) *DefaultPermissionHandler {
	return &DefaultPermissionHandler{emitter: emitter, broker: broker, scope: scope}
}

type permissionDecisionKey struct {
	runID     string
	requestID string
}

type brokeredPermission struct {
	pending  PendingPermissionRequest
	decision chan PermissionDecision
}

// PermissionDecisionBroker connects a live CLI control request to a later
// /v1/permissions/decide call. Requests are keyed by runId + requestId.
type PermissionDecisionBroker struct {
	mu      sync.Mutex
	pending map[permissionDecisionKey]brokeredPermission
}

func NewPermissionDecisionBroker() *PermissionDecisionBroker {
	return &PermissionDecisionBroker{
		pending: make(map[permissionDecisionKey]brokeredPermission),
	}
}

// Begin registers a pending permission request and returns a waiter. The waiter
// returns a safe deny decision if the run context is cancelled before a user
// decision arrives.
func (b *PermissionDecisionBroker) Begin(scope PermissionScope, req PermissionRequest) (func(context.Context) PermissionDecision, bool) {
	if b == nil {
		return nil, false
	}
	scope.RunID = strings.TrimSpace(scope.RunID)
	req.RequestID = strings.TrimSpace(req.RequestID)
	if scope.RunID == "" || req.RequestID == "" {
		return nil, false
	}
	key := permissionDecisionKey{runID: scope.RunID, requestID: req.RequestID}
	waiter := brokeredPermission{
		pending: PendingPermissionRequest{
			ProjectID: strings.TrimSpace(scope.ProjectID),
			ThreadID:  strings.TrimSpace(scope.ThreadID),
			RunID:     scope.RunID,
			RequestID: req.RequestID,
			ToolName:  strings.TrimSpace(req.ToolName),
			ToolUseID: strings.TrimSpace(req.ToolUseID),
			Input:     req.Input,
		},
		decision: make(chan PermissionDecision, 1),
	}

	b.mu.Lock()
	if _, exists := b.pending[key]; exists {
		b.mu.Unlock()
		return nil, false
	}
	b.pending[key] = waiter
	b.mu.Unlock()

	return func(ctx context.Context) PermissionDecision {
		select {
		case decision := <-waiter.decision:
			return NormalizePermissionDecision(decision)
		case <-ctx.Done():
			b.mu.Lock()
			delete(b.pending, key)
			b.mu.Unlock()
			return PermissionDecision{
				Behavior: "deny",
				Message:  "permission decision cancelled before approval was received",
			}
		}
	}, true
}

// Decide resolves and removes a pending permission request.
func (b *PermissionDecisionBroker) Decide(runID, requestID string, decision PermissionDecision) (PendingPermissionRequest, bool) {
	if b == nil {
		return PendingPermissionRequest{}, false
	}
	key := permissionDecisionKey{
		runID:     strings.TrimSpace(runID),
		requestID: strings.TrimSpace(requestID),
	}
	if key.runID == "" || key.requestID == "" {
		return PendingPermissionRequest{}, false
	}
	b.mu.Lock()
	waiter, ok := b.pending[key]
	if ok {
		delete(b.pending, key)
	}
	b.mu.Unlock()
	if !ok {
		return PendingPermissionRequest{}, false
	}
	waiter.decision <- NormalizePermissionDecision(decision)
	return waiter.pending, true
}

// NormalizePermissionDecision trims and validates a decision's behavior:
// only "allow"/"deny" survive; anything else (including empty) becomes a
// deny with a reason message. Exported so the acp subpackage can normalize
// broker decisions through the same SSOT path (#1760 acp 增量).
func NormalizePermissionDecision(decision PermissionDecision) PermissionDecision {
	decision.Behavior = strings.TrimSpace(decision.Behavior)
	switch decision.Behavior {
	case "allow", "deny":
		return decision
	default:
		if strings.TrimSpace(decision.Message) == "" {
			decision.Message = "invalid or missing permission decision"
		}
		decision.Behavior = "deny"
		return decision
	}
}

// PendingPermission reports whether a permission request is currently parked
// for the given run/request pair. Read-only: it never resolves or recycles
// the parked entry. Exported so the acp subpackage can assert broker
// lifecycle (register/recycle on cancel) without white-box access (#1760
// acp 增量).
func (b *PermissionDecisionBroker) PendingPermission(runID, requestID string) bool {
	if b == nil {
		return false
	}
	key := permissionDecisionKey{
		runID:     strings.TrimSpace(runID),
		requestID: strings.TrimSpace(requestID),
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	_, ok := b.pending[key]
	return ok
}

// WriteInterrupt sends an interrupt control_request to the CLI via stdin.
func WriteInterrupt(stdin io.Writer, requestID string) error {
	inner, err := json.Marshal(ControlRequestInner{Subtype: "interrupt"})
	if err != nil {
		slog.Debug("control: marshal interrupt inner failed", "error", err)
		return err
	}
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: requestID,
		Request:   inner,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = stdin.Write(data)
	return err
}

// WriteSetModel sends a set_model control_request.
func WriteSetModel(stdin io.Writer, requestID, model string) error {
	inner, err := json.Marshal(ControlRequestInner{Subtype: "set_model", Model: model})
	if err != nil {
		slog.Debug("control: marshal set_model inner failed", "error", err)
		return err
	}
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: requestID,
		Request:   inner,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = stdin.Write(data)
	return err
}

// WriteSetPermissionMode sends a set_permission_mode control_request.
func WriteSetPermissionMode(stdin io.Writer, requestID, mode string) error {
	inner, err := json.Marshal(ControlRequestInner{Subtype: "set_permission_mode", Mode: mode})
	if err != nil {
		slog.Debug("control: marshal set_permission_mode inner failed", "error", err)
		return err
	}
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: requestID,
		Request:   inner,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = stdin.Write(data)
	return err
}

// WriteStopTask sends a stop_task control_request for a sub-agent.
func WriteStopTask(stdin io.Writer, requestID, taskID string) error {
	inner, err := json.Marshal(ControlRequestInner{Subtype: "stop_task", TaskID: taskID})
	if err != nil {
		slog.Debug("control: marshal stop_task inner failed", "error", err)
		return err
	}
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: requestID,
		Request:   inner,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = stdin.Write(data)
	return err
}
