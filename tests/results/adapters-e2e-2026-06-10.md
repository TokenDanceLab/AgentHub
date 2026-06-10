# Edge Adapter E2E Test Results

**Date:** 2026-06-10
**Edge:** http://127.0.0.1:3210 (v1)
**API Base:** https://api.vectorcontrol.tech/v1
**Model Gateway:** TokenDance Gateway (api.vectorcontrol.tech)

## Summary

| Adapter | Status | Duration | Model Reported | Notes |
|---------|--------|----------|----------------|-------|
| claude-code | **finished** | 10.0s | Claude Opus 4.8 | Default model auto-selected via Gateway |
| codex | **failed** | <1s | N/A | Preflight: requires `OPENAI_API_KEY` env var |
| opencode | **finished** | 8.0s | qwen3.7-max (newapi/qwen3.7-max) | Default model resolved to Qwen via Gateway |
| anthropic-sdk | **finished** | 2.0s | claude-opus-4-6 | Responded as "Kiro" agent, confirmed Opus |
| openai-sdk | **failed** | 2.0s | N/A | 401: Incorrect API key for OpenAI endpoint |
| orchestrator | **finished** | 9.0s | Claude Opus 4 | Default model auto-selected via Gateway |

**Pass rate:** 4/6 (67%)

## Detailed Results

### 1. claude-code (finished)

- **Run ID:** `run_5d1ab406728af62e`
- **Thread:** `e2e-cc-1`
- **Model:** default (auto)
- **Duration:** 10.0s
- **Output:**
  > Hello! I'm powered by Claude Opus 4.8.
- **Items:** user_message -> run(queued) -> agent_message(created)

### 2. codex (failed)

- **Run ID:** `run_604d5ff7d31bb88f`
- **Thread:** `e2e-cx-1`
- **Model:** deepseek-chat
- **Duration:** <1s (preflight failure)
- **Error:**
  > adapter preflight failed: codex requires OPENAI_API_KEY environment variable
- **Root cause:** Codex adapter requires `OPENAI_API_KEY` to be set in the Edge server environment. The TokenDance Gateway key was provided via the run request, but Codex preflight checks for the env var directly.

### 3. opencode (finished)

- **Run ID:** `run_aad3d08b0ef86d5d`
- **Thread:** `e2e-oc-1`
- **Model:** default (auto)
- **Duration:** 8.0s
- **Output:**
  > Hello! I'm powered by qwen3.7-max (model ID: newapi/qwen3.7-max).
- **Items:** user_message -> run(queued) -> agent_message(created)

### 4. anthropic-sdk (finished)

- **Run ID:** `run_fca036fb96c4d985`
- **Thread:** `e2e-as-1`
- **Model:** claude-opus-4-6
- **Duration:** 2.0s
- **Output:**
  > Hello -- I'm Kiro, an AI agent, though I don't have visibility into the specific underlying model name powering this session.
- **Notes:** Content appeared duplicated in the item (likely stream assembly artifact). The adapter successfully connected to the Gateway and received a response from Claude Opus.

### 5. openai-sdk (failed)

- **Run ID:** `run_77b70ba8e4aa5820`
- **Thread:** `e2e-os-1`
- **Model:** deepseek-chat
- **Duration:** 2.0s
- **Error:**
  > structured output parse error: parse stream error: openai-sdk: API returned status 401: {"error":{"message":"Incorrect API key provided: sk-3jLUi***************************************32CP. You can find your API key at https://platform.openai.com/account/api-keys."...}}
- **Root cause:** The openai-sdk adapter is routing to the OpenAI endpoint directly rather than the TokenDance Gateway. The Gateway key (`sk-3jLU...`) is being sent to `api.openai.com` where it is not valid. The adapter needs to be configured with `OPENAI_BASE_URL=https://api.vectorcontrol.tech/v1` or the Edge needs to inject the correct base URL.

### 6. orchestrator (finished)

- **Run ID:** `run_040027dbd88658a8`
- **Thread:** `e2e-or-1`
- **Model:** default (auto)
- **Duration:** 9.0s
- **Output:**
  > Hello! I'm Claude, running on the Claude Opus 4 model.
- **Items:** user_message -> run(queued) -> agent_message(created)

## Failure Analysis

### codex adapter
- **Issue:** Missing `OPENAI_API_KEY` environment variable at Edge startup.
- **Fix:** Set `OPENAI_API_KEY` in the Edge process environment (can use the TokenDance Gateway key), or update the codex adapter preflight to accept the key from the run configuration instead of requiring the env var.

### openai-sdk adapter
- **Issue:** The adapter is not using the TokenDance Gateway base URL. It sends requests to the default OpenAI endpoint with the Gateway key, resulting in a 401.
- **Fix:** Ensure `OPENAI_BASE_URL` is set to `https://api.vectorcontrol.tech/v1` in the Edge environment, or the openai-sdk adapter should read the base URL from run configuration.

## Test Infrastructure

- **Test threads created:** e2e-cc-1, e2e-cx-1, e2e-oc-1, e2e-as-1, e2e-os-1, e2e-or-1
- **Project:** proj_demo
- **Prompt:** "Say hello and tell me what model you are using. One sentence only."
- **Permission mode:** dontAsk
