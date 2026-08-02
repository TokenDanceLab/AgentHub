# Hub delivery outbox retry wiring (#437 partial)

最后更新：2026-07-16

## Change
- `hub-server/internal/app/wiring.go` starts `AgentService.StartDeliveryRetryLoop(a.coreCtx)` with other background loops.
- Dispatch outbox record failures log explicit AH-SR-049 durability degradation (still fail-open for availability).

## Remaining for full AH-SR-049 close
- Edge journal / sequence / idempotent ack / reconciliation contract.
