# Engineering-loop capability map

最后更新：2026-07-19  
关联：Phase 71 / milestone 92 · Issues #1171–#1174  
定位：本地 **engineering loop**（会话/文件/变更/终端）与 IM workbench 的能力矩阵 SSOT。  
非目标：Web 直连 Local Edge；renderer raw process；在文档中出现第三方产品品牌名。

## 产品边界（保留）

| 面 | 职责 |
|---|---|
| Desktop | 本地工程循环主场：workspace、typed host port、Local Edge |
| Web | Hub 远程查看/审批；无本机 FS/PTY |
| Edge | 执行、runtime adapter、会话索引、artifact |
| Hub | IM、账号、同步、中继、审计 |

## Capability matrix

| ID | Capability | Current | Target (P71) | Acceptance | Surfaces | Risk |
|:--:|---|---|---|---|---|---|
| EL-1 | Local session aggregation | Local CLI discovery only (`HostDiagnosticsPort.localCliDiscovery`) | Read-only index of recent runtime sessions (Claude Code + Codex first); import summary for Desktop | Edge package + fixtures; no third-party store mutation | Edge, Desktop UI later | Path drift / privacy of home dirs |
| EL-2 | Dense workspace chrome | Global rail + conversation sidebar + RightInspector | Aux panel tab strip: session / files / changes / log | Tab availability tests; folder tabs require workspace | Desktop (Web: session-only) | Overlap with RightInspector |
| EL-3 | File tree + git changes loop | Diff/Preview in inspector; no first-class file tree tab | Aux panel slots for file tree + git changes + log (content via ports) | Shell + slots; FS/git only via Desktop host | Desktop | Large FS lists perf |
| EL-4 | In-app terminal host | None in shared platform | `localTerminal` capability + `TerminalPort` + panel shell (no real PTY yet) | Capability gating tests; mock Desktop true / Web false | Desktop | Security: typed API only |
| EL-5 | Multi-agent delegation surface | AgentTeam + orchestrator/sub-agent on Edge | Explicit sub-run / child-session UX residual (later wave) | Spec only in P71 map; implement after EL-1–4 | Hub/Edge/Desktop | Depth limits / cost |
| EL-6 | Skills / MCP management UX | Edge skills registry + MCP config; settings residual | Settings residual polish (later) | Not blocking EL-1–4 | Desktop/Edge | Scope creep |
| EL-7 | Automations / headless schedule | None first-class | Deferred | — | — | Ops complexity |
| EL-8 | Chat-channel remote control | Feishu/Lark integration path (ecosystem) | Residual only | No new channel in P71 | Hub | Provider coupling |

## Wave plan

| Wave | Issues | Deliverables |
|:----:|---|---|
| 0 | #1175 | MASTER open-set (done) |
| 1 | #1171 | This map |
| 1 | #1172 | Aux panel shell + tab logic |
| 1 | #1173 | Edge session index library + fixtures |
| 1 | #1174 | Terminal port types + panel shell |
| 2 | (follow-ups) | Wire aux into Desktop frame; real PTY; session import UI; git host port |

## Platform contract deltas (planned)

```ts
// SurfaceCapabilities (additive)
localFiles: boolean;      // existing
localTerminal?: boolean;  // #1174
localSessionIndex?: boolean; // optional later

// TerminalPort (Desktop host only) — #1174
interface TerminalPort {
  list?(): Promise<{ id: string; title: string }[]>;
  spawn?(opts: { cwd?: string; cols?: number; rows?: number }): Promise<{ id: string }>;
  write?(id: string, data: string): Promise<void>;
  resize?(id: string, cols: number, rows: number): Promise<void>;
  close?(id: string): Promise<void>;
}
```

## Red lines (non-negotiable)

1. UI never starts Agent CLI or shell directly.
2. Web never holds Local Edge or PTY.
3. Desktop renderer only via typed Tauri/Local Edge allowlist.
4. Import of foreign sessions is read-only observed/import mode.
5. Public commits/docs use product language only (engineering loop / workspace density).

## References

- [architecture.md](../architecture.md) · [04-frontend-data-flow.md](../architecture/04-frontend-data-flow.md)
- Platform: `app/shared/src/platform/types.ts`
- Workbench: `app/shared/src/workbench/`
- Edge adapters: `edge-server/internal/adapters/`
