# AgentHub Transport Package

`packages/transport` contains shared routing models and interfaces. It should not contain heavy runtime implementations.

## Layout

```text
packages/transport/
  model/      # TransportKind / Route / EdgeNode / RunnerEndpoint
  resolver/   # route resolver rules and pure selection logic
  client/     # transport client interfaces
```

## Runtime Implementations

Concrete transport implementations live in services:

```text
services/edge-server/internal/transport/
services/hub-server/internal/relay/
```

This keeps shared route semantics reusable without mixing Go/TS runtime concerns, SSH credentials, Tailscale details and Hub relay state into a single package.
