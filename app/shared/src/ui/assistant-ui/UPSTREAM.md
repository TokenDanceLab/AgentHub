# assistant-ui source

The `elements/`, `hooks/`, and `utils/` directories contain the official
[assistant-ui registry](https://r.assistant-ui.com/) Thread and ThreadList source,
retrieved on 2026-10-26 for `@assistant-ui/react` 0.15.31 and
`@assistant-ui/react-markdown` 0.14.24. They are distributed under the accompanying
MIT license.

Local adaptations are import paths, existing Radix primitives, product labels,
author/composer extension slots, capability checks, and compatibility with the
project's TypeScript target. The external-store adapter and transcript projection
live beside the registry source. Hub and Edge remain the message/execution owners;
the library owns chat interactions. No assistant-cloud service is used.
