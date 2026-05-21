# AgentHub Memory Core

Shared Go domain models and interfaces for project memory.

Owns:

- `.agenthub/` memory file references.
- context builder inputs.
- pinned memory references.
- thread summary metadata.

Does not own:

- vector database runtime.
- automatic long-term memory writing.
- workspace file mutation.
