# Edge CallbackReporter port (#435)

最后更新：2026-07-16

## Change
- Extracted Hub callback helpers from `process_executor.go` into `process_executor_hub_callback.go`.
- Introduced `lifecycle.CallbackReporter` interface implemented by `*hub.CallbackClient`.
- `ProcessExecutor.SetHubCallback` now accepts `CallbackReporter` (not concrete client only).

## Non-goals
- No behavior change to fire-and-forget semantics (AH-SR-049 Edge journal still open).
- No orchestrator package move in this slice.

## Tests
`go test ./internal/lifecycle -short`
