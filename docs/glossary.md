# AgentHub Glossary

Date: 2026-05-21

This document explains the common terms without shorthand.

| Term | Plain Meaning |
|---|---|
| UI | The screen people use: Desktop, Web or Mobile. It shows chats, runs, approvals, diffs and previews. |
| Hub Server | The central server. It handles accounts, contacts, groups, cross-device sync and relay. It does not run user code directly. |
| Edge Server | The local or remote control node near the project files. It manages projects, context, runner selection, artifact metadata and approval decisions. |
| Runner | The executor. It starts Claude Code, Codex or OpenCode, manages worktrees, streams logs and produces diffs/previews. |
| CLI Agent | An external coding tool such as Claude Code, Codex or OpenCode. AgentHub launches and observes it. |
| Edge Node | Any machine that can run an Edge Server and Runner. A laptop, lab machine or cloud VM can all be Edge Nodes. |
| Desktop Edge | The user's local desktop running UI + Edge Server + Runner. |
| Cloud Edge | A cloud machine running a headless Edge Server + Runner. |
| Conversation | The chat container. It may be a direct chat or group chat. |
| Thread | A task branch inside a conversation. One conversation can contain many threads. |
| Turn | One user or agent step inside a thread. |
| AgentRun | One actual execution by an agent. It has states like queued, running, awaiting approval, done, failed and cancelled. |
| Item | A timeline entry inside a thread: message, log chunk, command, approval request, diff, preview or error. |
| Artifact | A produced object such as a diff, file snapshot, log, screenshot, preview route or deployment result. |
| Approval | A user decision before a risky action, such as running a command, writing a sensitive path or deploying. |
| Worktree | An isolated git working directory for one AgentRun, so multiple agents do not overwrite each other. |
| Context Builder | The Edge component that assembles the prompt inputs before a Runner starts an agent. |
| Protocol Source | The authoritative protocol files under `proto/agenthub/v1`. Go and TypeScript types are generated from them. |
| Route Resolver | The component that chooses local, SSH/Tailscale or Hub relay connection paths. |
| Data Plane | The path for large or high-frequency data: logs, files, diffs, previews and artifact downloads. |
| Control Plane | The path for commands and state: start run, stop run, approve command, update status. |
| Sync Plane | The path that copies events and metadata between Edge and Hub. |
| Local Fast Path | A local-only shortcut where Desktop can read logs/diffs/previews from local Edge/Runner with short-lived permission. |
| Hub Relay | A relay through Hub when Web/Mobile or a NAT-hidden machine cannot directly reach an Edge Node. |
| Agent Profile | The visible identity of an agent: name, provider, runtime, status, skills and current task. |
| Agent Group | A named group of agents in a chat, usually coordinated by an Orchestrator. This is inspired by Multica squads but remains chat-first. |

Preferred wording:

- Say "single protocol source" or "唯一协议源头", not unexplained abbreviations.
- Say "AgentRun queue" when talking about execution scheduling.
- Say "EventStore" only when referring to durable event history; WebSocket is just delivery.
