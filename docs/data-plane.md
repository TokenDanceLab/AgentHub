# AgentHub Data Plane

Date: 2026-05-21

## Principle

The control plane decides what should happen. The data plane serves large or latency-sensitive resources.

AgentHub must not let UI directly access arbitrary remote Runner processes.

```text
UI -> nearest Edge
UI -> Local Runner Fast Path only when authorized by Edge
UI -> Hub proxy fallback
```

## Access Rules

1. UI does not directly access remote Runner.
2. UI may access Local Runner only in same-machine Desktop mode.
3. Local Runner Fast Path requires a short-lived token issued by Edge.
4. Remote Desktop and Cloud data plane must go through Remote Edge or Hub proxy.
5. Web/Mobile access always starts at Hub.

## Local Fast Path

Local Fast Path is an optimization, not a different authority model.

```text
Desktop UI -> Edge
Edge -> short-lived token
Desktop UI -> Local Runner data endpoint
```

Allowed resources:

- live stdout/stderr stream
- local preview iframe
- diff file read
- small artifact download

Forbidden resources:

- arbitrary workspace path read without Edge approval
- command execution
- remote Runner access
- long-lived bearer token reuse

## Preview Routes

```ts
type PreviewRoute =
  | { mode: "local"; url: "http://127.0.0.1:5173" }
  | { mode: "direct"; url: "http://100.x.x.x:5173" }
  | { mode: "ssh-tunnel"; localUrl: "http://127.0.0.1:5173" }
  | { mode: "hub-proxy"; url: "https://hub.example.com/preview/run_123" }
```

| Scenario | Preview Route |
|---|---|
| Desktop local | `local` |
| Desktop -> SSH remote | `ssh-tunnel` |
| Desktop -> Tailscale remote | `direct` via Remote Edge |
| Desktop -> Hub relay remote | `hub-proxy` or Remote Edge proxy |
| Web -> Desktop | `hub-proxy` |
| Web -> Cloud | `hub-proxy` or Cloud Edge public route |
| Mobile -> Desktop | `hub-proxy` |

## Artifact Locations

```ts
type ArtifactLocation =
  | { type: "edge-local"; edgeId: string; path: string }
  | { type: "edge-url"; edgeId: string; url: string }
  | { type: "hub-cache"; url: string }
  | { type: "object-storage"; url: string }
```

Rules:

- Artifact metadata syncs to Hub.
- Artifact bytes remain on Edge unless cached or exported.
- Hub can proxy artifact reads if the UI cannot reach the Edge.
- Large logs and workspace files are fetched on demand.
- Workspace trees are never globally uploaded by default.

## Data Plane By Topology

| Topology | Preferred Data Path | Fallback |
|---|---|---|
| Desktop local | UI -> Edge, optional Local Runner Fast Path | none |
| Desktop local online | UI -> Edge | Hub cache for synced metadata |
| Desktop direct remote | UI -> Local Edge -> Remote Edge | SSH tunnel |
| Desktop relay remote | UI -> Local Edge/Hub -> Hub proxy -> Remote Edge | Hub cache |
| Desktop direct Cloud | UI -> Local Edge -> Cloud Edge | SSH/Tailscale tunnel |
| Desktop relay Cloud | UI -> Hub proxy -> Cloud Edge | object storage |
| Web relay Desktop | UI -> Hub proxy -> Desktop Edge | Hub cache |
| Web relay Cloud | UI -> Hub proxy -> Cloud Edge | object storage |

## Security Notes

- Data tokens should be scoped to a run/artifact and expire quickly.
- Preview proxy should isolate origins per run.
- File reads should be rooted under the workspace root.
- Diff/log views should prefer immutable artifact IDs over raw paths.
- Hub relay should audit data-plane access for remote Desktop and Cloud Edge.
