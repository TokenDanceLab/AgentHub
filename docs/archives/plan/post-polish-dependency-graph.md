# Dependency Graph — Post-Polish Residual

> pending external archive — see docs/history.md

```mermaid
flowchart TD
  subgraph P79[Phase 79 Docs Authority]
    T791[T79.1 plan banners + MASTER]
    T792[T79.2 perf gate evidence note]
    T791 --> T792
  end

  subgraph P80[Phase 80 Mobile hubClient]
    T801[T80.1 inventory]
    T802[T80.2 thin re-export]
    T803[T80.3 RN boundary note]
    T801 --> T802 --> T803
  end

  T791 --> T801
```

## Parallelism

- B1 (docs) and B2 inventory (T80.1) can start after T79.1 lands; default serial for single-owner velocity.
- No file overlap between B1 and B2.
