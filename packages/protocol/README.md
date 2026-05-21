# AgentHub Protocol Package

`packages/protocol` contains generated protocol outputs.

## Layout

```text
packages/protocol/
  ts/         # generated TypeScript types
  go/         # generated Go structs
```

## Rule

Protocol shape changes start in `proto/agenthub/v1`. TypeScript and Go code should be generated from proto once generation is wired up.
