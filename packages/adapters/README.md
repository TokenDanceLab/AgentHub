# AgentHub Adapters Package

Shared Go interfaces for external CLI agent adapters.

Owns:

- adapter metadata.
- adapter capabilities.
- normalized start request and run result contracts.
- event normalization interfaces.

Does not own:

- subprocess lifecycle; Runner owns process start/stop.
- approval decisions; Edge owns policy decisions.
- UI rendering.
