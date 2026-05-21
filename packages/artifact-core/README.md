# AgentHub Artifact Core

Shared Go domain models for artifacts.

Owns:

- Artifact metadata.
- ArtifactLocation.
- PreviewRoute.
- diff metadata.
- log/file artifact references.

Does not own:

- reading arbitrary workspace paths.
- preview proxy implementation.
- object storage implementation.
