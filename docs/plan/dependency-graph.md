# Real Foundation Hardening - Dependency Graph

```mermaid
graph TD
  subgraph P1["Phase 1: Evidence Contract Foundation"]
    T11["T1.1 Evidence manifest contract"]
    T12["T1.2 Visual QA viewport/report"]
    T13["T1.3 Data-mode boundary reuse"]
    T14["T1.4 Evidence docs without duplication"]
    T11 --> T12
    T11 --> T13
    T11 --> T14
  end

  subgraph P2["Phase 2: Shared Chat Timeline Hardening"]
    T21["T2.1 Mixed-source golden fixtures"]
    T22["T2.2 Optimistic send and auto-follow"]
    T23["T2.3 Card grouping and radii"]
    T24["T2.4 Markdown and debug filtering"]
    T13 --> T21
    T21 --> T22
    T21 --> T23
    T21 --> T24
  end

  subgraph P3["Phase 3: Desktop/Web Boundary And Backend Truth"]
    T31["T3.1 Web Hub-only check"]
    T32["T3.2 Desktop phase split"]
    T33["T3.3 Observed/approved-real manifest boundary"]
    T22 --> T31
    T13 --> T32
    T11 --> T33
  end

  subgraph P4["Phase 4: Real E2E And Visual QA Closure"]
    T41["T4.1 Chat acceptance gate"]
    T42["T4.2 Semi-automated Visual QA artifact loop"]
    T43["T4.3 Packaged Desktop claim separation"]
    T22 --> T41
    T23 --> T41
    T31 --> T41
    T32 --> T41
    T12 --> T42
    T41 --> T42
    T41 --> T43
  end

  subgraph P5["Phase 5: Acceptance, Merge, Archive"]
    T51["T5.1 Final acceptance matrix"]
    T52["T5.2 Merge readiness and archive"]
    T41 --> T51
    T42 --> T51
    T43 --> T51
    T51 --> T52
  end
```

## Parallel Lane Notes

- Phase 1 can split evidence manifest/data-boundary work from docs, but Visual QA report work depends on the manifest shape.
- Phase 2 can split optimistic send/scroll from card/markdown rendering after golden fixtures exist.
- Phase 3 should run Web, Desktop, and manifest boundary work in separate worktrees to reduce conflicts.
- Phase 4 should keep acceptance-gate scripting separate from the semi-automated Visual QA artifact loop.
