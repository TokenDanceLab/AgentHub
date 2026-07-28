# PROGRESS — G12 sendFrame seq_id bypass characterization

- **Branch**: `inv/g12-sendframe-bypass` (base `master` @ `23ddb432`)
- **Audit ref**: `D:\Code\Temp\agenthub-observability-audit.md` G12
- **Status**: investigation + characterization + metric done; PR opened; NOT merged

## Investigation conclusion: KNOWN DEFECT (bug, not clearly intentional)

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

## Call sites

| Caller | File:line | Frame type | Path |
|--------|-----------|------------|------|
| `ServeWS` (production, only one) | `handler/ws.go:98` | `auth.ok` | bypass (sendFrame) |
| `TestSendFrameBufferFullWithoutMetricsRegistered` (test) | `ws_internal_test.go:29` | `auth.ok` | bypass |
| `TestSendFrameProducesZeroSeqIDLocksBypass` (new test) | `ws_internal_test.go` | `auth.ok` | bypass |
| `TestSendFrameBypassCounterIncrements` (new test) | `ws_internal_test.go` | `auth.ok` | bypass |

All other fanout frames go through `Manager.PushToConn` / `PushToUser` /
`PushToSession` and carry a stamped `seq_id`.

## Changes (discipline: no control-flow change)

1. `internal/metrics/metrics.go` — add `WSSendFrameBypass *CounterVec`
   (`ws_sendframe_bypass_total{frame_type}`), nil-guarded, registered in `once`.
2. `internal/handler/ws.go` — add KNOWN DEFECT comment on `sendFrame` + Inc the
   bypass counter (nil-guarded, aligned with #1441) after marshal success.
3. `internal/handler/ws_internal_test.go` — two characterization tests:
   - `TestSendFrameProducesZeroSeqIDLocksBypass` — locks that `sendFrame` frames
     reach the wire with no `seq_id` (absent via `omitempty`, SeqID=0).
   - `TestSendFrameBypassCounterIncrements` — locks the bypass counter behavior.

## Fix recommendation (NOT applied — operator decision)

Route `auth.ok` through `Manager.PushToConn` to unify seq_id stamping. This
gives auth.ok `seq_id=1` and shifts subsequent data frames by 1 (wire-visible,
M-grade). Alternative: add a documented seq_id exemption for control/handshake
frames to the manager.go contract if the team decides auth.ok should remain
bypass. Either path is an operator/main-control decision, out of scope for this
characterization PR.

## Local validation

- `go test ./internal/handler/... ./internal/ws/... ./internal/metrics/...` green
- `gofmt -w` clean; `git diff --check` clean
- nil-guard aligned with #1441 (builds without `metrics.Register()` do not panic)
