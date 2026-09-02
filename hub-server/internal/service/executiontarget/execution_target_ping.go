package executiontarget

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/egress"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

// defaultEdgePort is the standard Edge Server listen port used as a fallback
// when an execution target carries no explicit port.
const defaultEdgePort = 3210

func (s *Service) Ping(ctx context.Context, id, ownerID string) error {
	t, err := repository.GetExecutionTargetByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.UserNotFound
		}
		return err
	}
	if t.OwnerID != ownerID {
		return errcode.AuthDeviceMismatch
	}

	// Per-type health strategy (#1544): each target type proves its health
	// differently and records evidence; no strategy writes online on its own.
	switch t.TargetType {
	case "local_edge":
		return s.pingLocalEdge(ctx, t)
	case "remote_ssh", "tailscale", "cloud_edge":
		return s.pingRemote(ctx, t)
	case "hub_relay":
		return s.pingHubRelay(ctx, t)
	default:
		return errcode.ErrBadRequest.WithMessage("unsupported target_type")
	}
}

// pingLocalEdge triggers a route probe for a local_edge target (#1544).
// A manual ping is never online evidence on its own: the probe checks the
// bound desktop device's live WS route (device-exact), and only a real route
// produces online evidence. Unbound targets cannot be proven and stay
// registered/unknown.
func (s *Service) pingLocalEdge(ctx context.Context, t *model.ExecutionTarget) error {
	if t.DeviceID == nil || strings.TrimSpace(*t.DeviceID) == "" {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOffline, "missing_device_binding", "", "")
		return errcode.TargetNotRoutable.WithMessage("local edge is not bound to a device")
	}
	if s.cache == nil {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusUnknown, "route_proof_unavailable", "", "")
		return errcode.TargetNotRoutable.WithMessage("execution target health proof is not available")
	}
	deviceType := "desktop"
	routeKey := targetRouteKey(t.OwnerID, deviceType, *t.DeviceID)
	_, err := s.cache.GetRouteForDevice(ctx, t.OwnerID, deviceType, *t.DeviceID)
	if err != nil {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOffline, "no_route", "", routeKey)
		return errcode.TargetNotRoutable.WithMessage("local edge route not found: bound desktop device has no live connection")
	}
	_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOnline, "", "", routeKey)
	return nil
}

// pingRemote probes a remote_ssh / tailscale / cloud_edge target over HTTP
// through the fail-closed egress transport (#1540) and records probe
// evidence (protocol-independent: observed target id + failure category).
func (s *Service) pingRemote(ctx context.Context, t *model.ExecutionTarget) error {
	if t.Host == "" {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOffline, "no_host", "", "")
		return errcode.TargetNotRoutable.WithMessage("execution target has no host configured")
	}
	port := t.Port
	if port == 0 {
		port = defaultEdgePort
	}
	addr := net.JoinHostPort(t.Host, fmt.Sprintf("%d", port))
	return s.pingEdgeServer(ctx, addr, t)
}

// pingHubRelay proves an exact device route for a hub_relay target (#1544).
// The owner having any WebSocket connection is no longer sufficient — the
// bound device itself must have a live route (user + device identity).
func (s *Service) pingHubRelay(ctx context.Context, t *model.ExecutionTarget) error {
	if s.cache == nil {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusUnknown, "route_proof_unavailable", "", "")
		return errcode.TargetNotRoutable.WithMessage("execution target health proof is not available")
	}
	if t.DeviceID == nil || strings.TrimSpace(*t.DeviceID) == "" {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusOffline, "missing_device_binding", "", "")
		return errcode.TargetNotRoutable.WithMessage("relay route proof requires a bound device")
	}
	device, err := repository.GetDeviceByID(s.db.WithContext(ctx), *t.DeviceID)
	if err != nil {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusOffline, "bound_device_missing", "", "")
		return errcode.TargetNotRoutable.WithMessage("bound device not found")
	}
	routeKey := targetRouteKey(t.OwnerID, device.DeviceType, device.ID)
	_, err = s.cache.GetRouteForDevice(ctx, t.OwnerID, device.DeviceType, device.ID)
	if err != nil {
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusOffline, "no_route", "", routeKey)
		return errcode.TargetNotRoutable.WithMessage("relay route not available: target device has no live connection")
	}
	_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceRelayRoute, dispatch.EvidenceStatusOnline, "", "", routeKey)
	return nil
}

// recordEvidence persists the latest health evidence for a target (#1544).
// Every health state change funnels through here; the readable health fields
// are projections only. Persistence failure is logged (the probe itself
// succeeded — the caller's error, if any, is the probe verdict, not this).
func (s *Service) recordEvidence(ctx context.Context, targetID, source, status, failureCategory, observedTargetID, routeKey string) error {
	now := time.Now()
	expires := now.Add(dispatch.DesktopTargetStaleAfter)
	ev := &model.ExecutionTargetEvidence{
		TargetID:         targetID,
		Source:           source,
		Status:           status,
		FailureCategory:  failureCategory,
		ObservedTargetID: observedTargetID,
		RouteKey:         routeKey,
		ObservedAt:       now,
		ExpiresAt:        &expires,
	}
	if err := repository.UpsertExecutionTargetEvidence(s.db.WithContext(ctx), ev); err != nil {
		slog.Error("execution target: failed to record health evidence", "target_id", targetID, "source", source, "status", status, "error", err)
		return err
	}
	return nil
}

// pingEdgeServer performs an HTTP GET /v1/health against the Edge Server
// through the fail-closed egress transport (#1540): default-deny on
// restricted networks (loopback/private/link-local/metadata) unless an
// administrator allowlist covers the address. No credential is attached —
// AuthCredential is not persisted (no secret source), and hub-initiated
// pings must not carry secrets to arbitrary targets.
func (s *Service) pingEdgeServer(ctx context.Context, addr string, t *model.ExecutionTarget) error {
	// Scheme comes from the egress policy: https default, plain http only
	// with explicit egress.allow_plain_http (trusted local policy).
	url := s.egress.Scheme() + "://" + addr + "/v1/health"

	resp, err := s.egress.Get(ctx, url)
	if err != nil {
		// The egress error string embeds the resolved internal address of the
		// target; keep it server-side (log) and return a generic message so
		// restricted-network topology is not echoed to API consumers
		// (#2154 security lane F17).
		slog.Info("execution target ping failed", "target_id", t.ID, "error", err)
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOffline, "connect", "", "")
		// Preserve the policy-denial reason (tests assert it names the egress
		// policy) without echoing the resolved internal address to the API
		// consumer (#2154 security lane F17).
		return errcode.TargetNotRoutable.WithMessage("ping failed: " + pingFailureReason(err))
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		if observedTargetID := observedTargetIDFromHealthBody(body); observedTargetID != "" && observedTargetID != t.ID {
			_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusMismatch, "mismatch", observedTargetID, "")
			return errcode.TargetNotRoutable.WithMessage("execution target health mismatch")
		}
		_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOnline, "", "", "")
		return nil
	}

	_ = s.recordEvidence(ctx, t.ID, dispatch.EvidenceSourceProbe, dispatch.EvidenceStatusOffline, fmt.Sprintf("http_%d", resp.StatusCode), "", "")
	return errcode.TargetNotRoutable.WithMessage(fmt.Sprintf("ping returned HTTP %d", resp.StatusCode))
}

// pingFailureReason maps an egress ping failure onto an API-safe reason string.
//
// Classification uses errors.Is against egress's typed sentinels, as that
// package explicitly requires (egress.go:40-42: "Callers should use errors.Is
// to distinguish policy refusals from transient network failures without
// relying on error message text"). The previous strings.Contains(err.Error(),
// "not allowed") test violated that contract: egress.ErrUnsupportedScheme reads
// "egress: unsupported URL scheme (https required, or http with AllowPlainHTTP)"
// and contains no "not allowed", so a scheme refused by policy was reported to
// API consumers as "ping failed: target unreachable" — sending operators after
// the network instead of after the target configuration.
//
// Every returned reason is a constant: the egress error text embeds the
// resolved internal address and must never reach API consumers (#2154 security
// lane F17); the full error stays in the slog line above. The wording of the
// restricted-address branch is load-bearing — execution_target_test.go:267
// asserts the surfaced error contains "not allowed".
//
// Extracted from pingEdgeServer so it is testable: Service.egress is the
// concrete *egress.Client (execution_target.go:26) and Scheme() only ever
// yields http/https, so the scheme and plain-http sentinels cannot be produced
// through the ping path to be observed end-to-end.
func pingFailureReason(err error) string {
	switch {
	case errors.Is(err, egress.ErrRestrictedAddress):
		return "target not allowed by egress policy"
	case errors.Is(err, egress.ErrPlainHTTPDenied):
		return "plain http not allowed by egress policy"
	case errors.Is(err, egress.ErrUnsupportedScheme):
		return "target URL scheme not allowed by egress policy"
	default:
		// Transient network / DNS / timeout failures: not a policy statement.
		return "target unreachable"
	}
}

func observedTargetIDFromHealthBody(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		return ""
	}
	for _, key := range []string{"target_id", "targetId"} {
		if value, ok := raw[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	data, ok := raw["data"].(map[string]any)
	if !ok {
		return ""
	}
	for _, key := range []string{"target_id", "targetId"} {
		if value, ok := data[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
