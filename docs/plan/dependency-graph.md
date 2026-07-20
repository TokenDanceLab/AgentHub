# Task Dependency Graph

> **HISTORICAL — cleanup-baseline freeze (closed 2026-07-16 / PR #446).**
> **Not live backlog.** Live program SSOT: [../progress/MASTER.md](../progress/MASTER.md) (post-polish residual Phases 79–80).
> Snapshot also under [../archives/cleanup-baseline/plan/](../archives/cleanup-baseline/plan/).

```mermaid
graph TD
  subgraph P1 [Phase 1 Governance Lock]
    T11[T1.1 GitHub Project + Issues]
    T12[T1.2 Freeze ad-hoc fleets]
    T13[T1.3 Image/CD naming decision]
    T11 --> T12
  end

  subgraph P2 [Phase 2 Hygiene residual]
    T21[T2.1 Dirty tree policy]
    T22[T2.2 Neutralize stale agent memory]
    T23[T2.3 Demote old deploy templates]
    T11 --> T21
    T13 --> T23
  end

  subgraph P3 [Phase 3 Frontend strangler]
    T31[T3.1 hubClient types/matrix]
    T32[T3.2 shared method parity]
    T33[T3.3 desktop cutover]
    T34[T3.4 web cutover + AH-SR-043]
    T11 --> T31
    T31 --> T32
    T32 --> T33
    T32 --> T34
  end

  subgraph P4 [Phase 4 Edge + security]
    T41[T4.1 handlers split]
    T42[T4.2 executor seams]
    T43[T4.3 capability loop 046]
    T44[T4.4 delivery loop 049]
    T11 --> T41
    T41 --> T42
    T41 --> T43
    T42 --> T44
  end

  subgraph P5 [Phase 5 Closure]
    T51[T5.1 AH-SR-037 decision]
    T52[T5.2 Settings/TeamRun decision]
    T53[T5.3 Program closeout]
    T11 --> T51
    T32 --> T52
    T51 --> T53
  end

  subgraph P6 [Phase 6 Baseline Hardening]
    T61[T6.1 desktop tsc residual]
    T62[T6.2 web hubClient align]
    T63[T6.3 extract SectionId]
    T64[T6.4 purpose=run-start]
    T65[T6.5 SQLite DeliveryJournal]
    T33 --> T61
    T34 --> T62
    T52 --> T63
    T43 --> T64
    T44 --> T65
  end

  subgraph P7 [Phase 7 CI Green + SDD Closeout — COMPLETE]
    T71[T7.1 hubClient envelope + contracts]
    T72[T7.2 trailing whitespace]
    T73[T7.3 plan docs sync]
    T74[T7.4 SDD archive]
    T75[T7.5 re-verify PR CI]
    T62 --> T71
    T65 --> T73
    T73 --> T74
    T71 --> T75
    T72 --> T75
    T74 --> T75
  end

  P1 --> P2
  P1 --> P3
  P1 --> P4
  P3 --> P5
  P4 --> P5
  P5 --> P6
  P6 --> P7
```
