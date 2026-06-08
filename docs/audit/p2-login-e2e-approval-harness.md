# P2 Login E2E Approval Harness

This slice prepares a real TokenDanceID login and remote-control E2E harness. It does not perform real login, does not call live Hub or TokenDanceID endpoints, does not dispatch remote work, and does not record token values.

## Approval Gate

Real mode requires all of the following before the Playwright E2E may run:

| Input | Requirement |
|---|---|
| OAuth client | `AGENTHUB_LOGIN_E2E_OAUTH_CLIENT_ID` names the approved AgentHub test client. |
| Callback URL | `AGENTHUB_LOGIN_E2E_CALLBACK_URL` matches the registered Hub/Web callback URL. |
| Hub base URL | `AGENTHUB_LOGIN_E2E_HUB_BASE_URL` points to the approved Hub test environment, not Local Edge. |
| Web URL | `AGENTHUB_LOGIN_E2E_WEB_URL` points to the approved Web app, not Local Edge. |
| Test account | `AGENTHUB_LOGIN_E2E_TEST_ACCOUNT_INDICATOR` clearly says disposable, test, throwaway, or sandbox. |
| Artifact root | `AGENTHUB_LOGIN_E2E_ARTIFACT_ROOT` stays under `.tmp/` or `tmp/`. |
| Browser evidence boundary | `AGENTHUB_LOGIN_E2E_BROWSER_EVIDENCE_BOUNDARY` is `metadata-only` or `redacted-screenshots`. |
| Operator approval | `AGENTHUB_LOGIN_E2E_OPERATOR_APPROVAL_ID` plus `AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN=true`. |
| Dispatch approval | `AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH=true` is separate from login approval. |

Use the readiness verifier before real-mode Playwright:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-login-e2e-readiness.ps1 -RepoRoot . -Mode RealApproved -UseEnvironment
```

The verifier is fail-closed. Default `ProposalOnly` exits blocked, and `RealApproved` exits non-zero unless the env/approval/proof contract is complete.

## Evidence Contract

The real run must produce a redacted manifest with these proofs:

| Proof | Required content |
|---|---|
| Hub session | Hub-issued session exists after TokenDanceID login; no raw TokenDanceID or Hub token value is stored. |
| Target inventory | Hub `/web/execution-targets` returns owner-scoped target inventory. |
| Selected Desktop target | The selected target is online `local_edge`, bound to a Desktop/Edge device, and not a direct Local Edge URL chosen by Web. |
| Dispatch request | Hub dispatch request includes the selected `target_id`; dispatch uses Hub routes only. |
| Event replay | Hub event replay after dispatch contains dispatch/routing evidence for the same run/task/target. |

Review an evidence manifest offline:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-login-e2e-readiness.ps1 -RepoRoot . -Mode EvidenceReview -UseEnvironment
```

## Negative Gates

The test script covers:

- missing env/prerequisites;
- unsafe token-like input output;
- unapproved real mode;
- direct Web-to-LocalEdge URL, including `localhost`, `[::1]`, and `127.0.0.0/8` aliases on the configured Local Edge port;
- path traversal artifact roots such as `.tmp/../docs/audit`;
- missing target inventory proof.
- opaque sensitive evidence fields such as `access_token`, `refresh_token`, `id_token`, `token`, `secret`, and `authorization` unless the value is an explicit redaction placeholder;
- direct Local Edge URLs embedded in evidence proof fields, even when `web_to_local_edge_direct=false`.

Verification:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tests\scripts\verify-login-e2e-readiness.ps1 -RepoRoot .
```

## Non-Goals

- No real login by the readiness verifier.
- No token, password, cookie, authorization header, or refresh token in logs or artifacts.
- No production account, production Hub, public deploy, signing, release upload, or model/CLI spend.
- No Web direct call to Local Edge, Tauri, filesystem, or localhost runtime APIs.
