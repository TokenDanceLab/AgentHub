# Adapter E2E Test Results — 2026-06-10

**Edge Server**: `http://127.0.0.1:3210` (agenthub-edge.exe, PID 86268)  
**API Proxy**: `https://api.vectorcontrol.tech/v1`  
**Test Time**: 2026-06-10T04:58:11Z ~ 05:00:22Z  
**Test Method**: Direct curl POST /v1/runs, poll status after 15s

---

## Adapter Results

| # | Adapter | Model | Run ID | Status | Verdict |
|---|---------|-------|--------|--------|---------|
| 1 | `claude-code` | (default) | `run_e16368c6b66ccef1` | failed | **FAIL** |
| 2 | `codex` | deepseek-chat | `run_c13e90b96e1029ab` | failed | **FAIL** |
| 3 | `opencode` | (default) | `run_e8f4c917e38d7575` | failed | **FAIL** |
| 4 | `anthropic-sdk` | claude-opus-4-6 | `run_5dc1d39d81362051` | finished | **PASS** |
| 5 | `openai-sdk` | deepseek-chat | `run_fd1bd91f9fc5d5c1` | failed | **FAIL** |
| 6 | `orchestrator` | (default) | `run_6471268565a6e6cc` | failed | **FAIL** |

**Summary: 1/6 PASS, 5/6 FAIL**

---

## Detailed Results

### 1. claude-code — FAIL
- **Create Response**: `{"code":"OK","data":{"runId":"run_e16368c6b66ccef1","status":"queued",...}}`
- **Final Status**: `failed` (created 04:58:11, finished 04:58:15, ~4s runtime)
- **Notes**: Adapter started but failed quickly. Likely claude CLI binary not found or exec error.

### 2. codex — FAIL
- **Create Response**: `{"code":"OK","data":{"runId":"run_c13e90b96e1029ab","status":"queued",...}}`
- **Final Status**: `failed` (created 04:58:46, finished 04:58:46, instant failure)
- **Notes**: Instant failure — codex adapter likely not finding the codex CLI binary or exec failure.

### 3. opencode — FAIL
- **Create Response**: `{"code":"OK","data":{"runId":"run_e8f4c917e38d7575","status":"queued",...}}`
- **Final Status**: `failed` (created 04:59:11, finished 04:59:12, ~1s runtime)
- **Notes**: Quick failure. opencode CLI binary likely not found or exec error.

### 4. anthropic-sdk — PASS
- **Create Response**: `{"code":"OK","data":{"runId":"run_5dc1d39d81362051","status":"queued",...}}`
- **Final Status**: `finished` (created 04:59:32, started 04:59:33, finished 04:59:35, ~2s runtime)
- **Notes**: Direct Anthropic SDK call via API proxy succeeded. This is the only adapter that does NOT spawn a CLI subprocess — it calls the API directly.

### 5. openai-sdk — FAIL
- **Create Response**: `{"code":"OK","data":{"runId":"run_fd1bd91f9fc5d5c1","status":"queued",...}}`
- **Final Status**: `failed` (created 04:59:55, started 04:59:55, finished 04:59:57, ~2s runtime)
- **Notes**: OpenAI-compatible SDK call failed. Likely API auth or model routing issue with deepseek-chat through the proxy.

### 6. orchestrator — FAIL
- **Create Response**: `{"code":"OK","data":{"runId":"run_6471268565a6e6cc","status":"queued",...}}`
- **Final Status**: `failed` (created 05:00:19, started 05:00:19, finished 05:00:22, ~3s runtime)
- **Notes**: Orchestrator failed. May depend on sub-adapters that are failing.

---

## Auxiliary Endpoint Results

### cc-switch/status — PASS
```
HTTP 200
{
  "code": "OK",
  "data": {
    "installed": true,
    "dbPath": "C:\Users\Ding\.cc-switch\cc-switch.db",
    "configDir": "C:\Users\Ding\.cc-switch",
    "routingActive": true,
    "proxyPort": 15721,
    "activeAppTypes": ["claude", "codex", "gemini"]
  }
}
```

### memory?workDir=C:/Users/Ding — FAIL
```
HTTP 404 — "404 page not found"
```
Memory endpoint is not registered on this Edge build.

---

## Analysis

**Failure Pattern**:
- The 3 CLI-based adapters (`claude-code`, `codex`, `opencode`) all fail — likely the CLI binaries are not in PATH or the adapters cannot spawn subprocesses correctly.
- `openai-sdk` (direct HTTP) fails — possible API key / model name issue with `deepseek-chat` through the proxy.
- `orchestrator` fails — likely cascading from sub-adapter failures.
- Only `anthropic-sdk` (direct Anthropic API call with valid model `claude-opus-4-6`) succeeds.

**Root Cause Hypothesis**:
1. CLI adapters: Binary discovery or exec environment issue in the running Edge process.
2. openai-sdk: The `deepseek-chat` model may not route correctly through `api.vectorcontrol.tech` via the OpenAI-compatible endpoint, or the API key is missing/misconfigured.
3. orchestrator: Depends on working sub-adapters; cascading failure.

