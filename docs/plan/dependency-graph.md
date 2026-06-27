# Task Dependency Graph

```mermaid
graph TD
    subgraph P1["Phase 1: Governance Baseline"]
        T11["T1.1 Branch/worktree governance"]
        T12["T1.2 Document standards"]
        T13["T1.3 Skill whitelist verifier"]
        T14["T1.4 Generated artifact hygiene"]
        T11 --> T13
        T12 --> T13
    end

    subgraph P2["Phase 2: Real E2E Contract"]
        T21["T2.1 Evidence-level matrix"]
        T22["T2.2 Data/surface/auth/execution axes"]
        T23["T2.3 E2E smoke manifests"]
        T24["T2.4 Visual QA acceptance"]
        T12 --> T21
        T21 --> T22
        T21 --> T23
        T21 --> T24
    end

    subgraph P3["Phase 3: Source And Test Alignment"]
        T30["T3.0 API/Hub doc owner trim"]
        T30B["T3.0b Module README trim"]
        T30C["T3.0c Progress/doc SSOT sync"]
        T31["T3.1 Chat transcript behavior tests"]
        T32["T3.2 Frontend architecture docs"]
        T33["T3.3 Backend/API perf and leak gates"]
        T34["T3.4 Desktop packaged evidence"]
        T35["T3.5 Web/Mobile/client test lanes"]
        T30 --> T30B
        T30B --> T30C
        T22 --> T31
        T24 --> T31
        T31 --> T32
        T21 --> T33
        T21 --> T34
        T21 --> T35
    end

    subgraph P4["Phase 4: Acceptance And Merge Readiness"]
        T41["T4.1 Focused acceptance gate bundle"]
        T42["T4.2 Cross-review and architecture approval"]
        T43["T4.3 Merge-readiness and archive preparation"]
        T30C --> T41
        T31 --> T41
        T33 --> T41
        T34 --> T41
        T35 --> T41
        T41 --> T42
        T42 --> T43
    end
```

## Parallel Lane Notes

- Phase 1 can start with lanes A/B/D in parallel; T1.3 waits for T1.1 and T1.2.
- Phase 2 can run T2.3 and T2.4 after T2.1; T2.2 is higher merge risk because it may touch shared source contracts.
- Phase 3 lanes should use separate worktrees if run by multiple agents because frontend, backend, desktop package, and mobile/web lanes are mostly independent.
- Phase 4 is intentionally sequential because evidence, review, and merge readiness depend on the combined diff.
