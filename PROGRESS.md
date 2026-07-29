# PROGRESS — 观测 counters (G3/G4/G9/G11) + G12 sendFrame bypass characterization

- worktree: `feat/observability-counters` (base master `23ddb432`, rebased onto `e1cdb74c` 含 #1446 G12)
- 审计依据: `D:\Code\Temp\agenthub-observability-audit.md` G3/G4/G9/G11 + G12
- 状态: rebase onto master (#1446 G12) 完成；metrics Register 块双方 counter 保留（WSSendFrameBypass + 8 个 D counter）；NOT merged

## D 批观测 counters (G3/G4/G9/G11)

### 落地清单

#### G3 — Delivery outbox retry / dead-letter / redispatch
- metrics: `delivery_outbox_retry_attempts_total` (Counter), `delivery_outbox_dead_letter_total{reason}` (CounterVec), `delivery_outbox_redispatch_failures_total` (Counter), `delivery_outbox_scan_failures_total` (Counter)
- 落地点:
  - `delivery_outbox.go` retry-scheduled Inc (claimDeliveryRetrying 成功)
  - `delivery_outbox.go` dead-letter max_attempts + explicit Inc
  - `delivery_outbox_retry.go` scan-fail Inc
  - `delivery_outbox_retry.go` redispatch-fail Inc

#### G4 — Edge HTTP dispatch 6 类失败
- metrics: `agent_dispatch_edge_http_failures_total{reason}` (CounterVec)
- reason: insecure_cleartext / marshal_failed / req_create_failed / unreachable / non_success / decode_fail
- 唯一行为变化: unreachable slog.Debug → slog.Warn (生产可见)

#### G9 — JWT/WS auth 验证失败
- metrics: `jwt_verification_failures_total{reason}` (CounterVec), `ws_auth_failures_total{reason}` (CounterVec), `jti_blacklist_check_errors_total` (Counter)
- reason (jwt): invalid_token / hub_session_reject / jti_blacklisted / legacy_no_jti
- reason (ws): missing_token / invalid_token
- WS 路径补 audit log (auditPermission) + metric Inc

#### G11 — redis_pool_hits Gauge→Counter 修复
- 原 `redis_pool_hits` (Gauge) → `redis_pool_hits_total` (Counter)
- admin.go startMetricsCollector 改为 delta-tracking Add() (PoolStats().Hits 是累计单调值)

### 纪律遵守
- nil-guard 模式对齐 #1441 (if metrics.X != nil)
- 不改业务控制流 / 返回值 / 签名
- G4 unreachable slog.Debug→Warn 是唯一行为变化
- 新 counter 均 MustRegister

## G12 sendFrame seq_id bypass characterization (#1446, master)

- **Branch**: `inv/g12-sendframe-bypass` (base `master` @ `23ddb432`)
- **Audit ref**: `D:\Code\Temp\agenthub-observability-audit.md` G12
- **Status**: investigation + characterization + metric done; merged to master via #1446

### Investigation conclusion: KNOWN DEFECT (bug, not clearly intentional)

`handler/ws.go:220-233` `sendFrame` writes directly to `conn.Send`, bypassing
`Manager.PushToConn` and therefore the per-connection `seq_id` stamping at
`manager.go:387` (`frame.SeqID = c.seq.Add(1)`).

Evidence this is a defect (contract violation), not intentional:
- `manager.go:362-369` docstring states "every delivery attempt that reaches
  the connection is stamped with the connection's monotonic seq_id" — `auth.ok`
  reaches the connection but is not stamped.
- No comment in `sendFrame` or at `ws.go:98` explains why it bypasses.
- `frame.go:7-9` scopes seq_id stamping to PushToConn but does not exempt auth.ok.

Practical impact is limited: the only production caller is `ws.go:98` sending
`TypeAuthOK` (handshake ack, no business payload, sent synchronously before the
read loop starts). Clients losing auth.ok reconnect via heartbeat timeout.
First data frame still gets `seq_id=1` (auth.ok consumes no seq), so gap
detection for data frames is not affected.

### Call sites

| Caller | File:line | Frame type | Path |
|--------|-----------|------------|------|
| `ServeWS` (production, only one) | `handler/ws.go:98` | `auth.ok` | bypass (sendFrame) |
| `TestSendFrameBufferFullWithoutMetricsRegistered` (test) | `ws_internal_test.go:29` | `auth.ok` | bypass |
| `TestSendFrameProducesZeroSeqIDLocksBypass` (new test) | `ws_internal_test.go` | `auth.ok` | bypass |
| `TestSendFrameBypassCounterIncrements` (new test) | `ws_internal_test.go` | `auth.ok` | bypass |

All other fanout frames go through `Manager.PushToConn` / `PushToUser` /
`PushToSession` and carry a stamped `seq_id`.

### G12 changes (discipline: no control-flow change)

1. `internal/metrics/metrics.go` — add `WSSendFrameBypass *CounterVec`
   (`ws_sendframe_bypass_total{frame_type}`), nil-guarded, registered in `once`.
2. `internal/handler/ws.go` — add KNOWN DEFECT comment on `sendFrame` + Inc the
   bypass counter (nil-guarded, aligned with #1441) after marshal success.
3. `internal/handler/ws_internal_test.go` — two characterization tests:
   - `TestSendFrameProducesZeroSeqIDLocksBypass` — locks that `sendFrame` frames
     reach the wire with no `seq_id` (absent via `omitempty`, SeqID=0).
   - `TestSendFrameBypassCounterIncrements` — locks the bypass counter behavior.

### Fix recommendation (NOT applied — operator decision)

Route `auth.ok` through `Manager.PushToConn` to unify seq_id stamping. This
gives auth.ok `seq_id=1` and shifts subsequent data frames by 1 (wire-visible,
M-grade). Alternative: add a documented seq_id exemption for control/handshake
frames to the manager.go contract if the team decides auth.ok should remain
bypass. Either path is an operator/main-control decision, out of scope for this
characterization PR.

## 本地校验

- D 批: go test ./internal/metrics/... ./internal/service/... ./internal/middleware/... — 绿
- D 批: go build ./internal/app/... — 绿；go vet — clean；gofmt -w — 已跑；git diff --check — clean
- G12: `go test ./internal/handler/... ./internal/ws/... ./internal/metrics/...` green
- nil-guard aligned with #1441 (builds without `metrics.Register()` do not panic)
