# AgentHub Protocol Package

`packages/protocol` is schema-first.

## Layout

```text
packages/protocol/
  schema/     # JSON Schema / OpenAPI / AsyncAPI source of truth
  ts/         # generated TypeScript types
  go/         # generated Go structs
```

## Rule

Protocol shape changes start in `schema/`. TypeScript and Go code should be generated from schema once generation is wired up.
