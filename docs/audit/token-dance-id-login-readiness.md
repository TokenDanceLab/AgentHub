# TokenDanceID Login Readiness Closure

This note is the shortest no-secret path from the current TokenDanceID readiness
`BLOCKED` state to an operator-approved real-login run. It does not authorize a
real browser login, credential entry, token exchange, model/API spend, deploy,
signing, release upload, or Mobile testing.

## Required No-Secret Values

| Value | Env / parameter | How to get it | Required format |
|---|---|---|---|
| TokenDanceID issuer URL | `AGENTHUB_TDID_LOGIN_ISSUER_URL` / `-IssuerUrl` | Operator reads the approved TokenDanceID environment issuer from the identity deployment or its public OIDC discovery document. | `https://id.vectorcontrol.tech` style absolute `http(s)` URL. Do not include query strings, tokens, cookies, or credentials. |
| AgentHub OIDC client id | `AGENTHUB_TDID_LOGIN_CLIENT_ID` / `-ClientId` | Operator reads the public client identifier from the approved TokenDanceID OAuth/OIDC client registered for AgentHub. | Public client id only, for example `agenthub-web` or another approved opaque id. Never use `AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET`. |
| Approved test account reference | `AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF` / `-TestAccountRef` | Operator creates or selects a disposable/pre-approved test account in the secret store or test-account register, then shares only the reference label. | A non-secret label containing `approved`, `test`, `disposable`, `sandbox`, or `throwaway`, for example `approved-disposable:agenthub-login-smoke:<ticket-id>`. Do not include password, OTP, recovery code, token, cookie, or raw email if it is private. |

Optional offline discovery fixture:
`AGENTHUB_TDID_LOGIN_DISCOVERY_DOCUMENT` / `-DiscoveryDocumentPath` can point to
a checked-out local JSON copy of `/.well-known/openid-configuration` for script
contract tests. Fixture discovery can make the readiness script pass, but it is
not real-login evidence.

## Set For One Shell

Use process-local variables only. Do not write these values to committed files if
the account reference is private.

```powershell
$env:AGENTHUB_TDID_LOGIN_ISSUER_URL = "https://id.vectorcontrol.tech"
$env:AGENTHUB_TDID_LOGIN_CLIENT_ID = "<approved-agenthub-client-id>"
$env:AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF = "approved-disposable:agenthub-login-smoke:<ticket-id>"
```

## Commands After Values Are Set

First produce the TokenDanceID readiness JSON:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-token-dance-id-login-readiness.ps1 `
  -RepoRoot . `
  -OutputPath .\.tmp\tokendance-id-login-readiness.json
```

Expected status before any real login: `READY_FOR_OPERATOR`. If the status is
`BLOCKED`, fix only the no-secret metadata or discovery reachability first.

Then compose it into the P0 gold-path harness with the existing no-spend and
redacted evidence files, or let the harness run the no-secret readiness gate:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-p0-approved-real-gold-path.ps1 `
  -RepoRoot . `
  -ArtifactRoot .\.tmp\p0-approved-real-gold-path\operator-ready `
  -TokenDanceIDReadinessPath .\.tmp\tokendance-id-login-readiness.json
```

The harness may still return `BLOCKED_WITH_EVIDENCE` until Desktop/Edge/CLI
no-spend evidence and Hub replay/Web redacted-manifest evidence are supplied or
run. That status is valid evidence, not permission to run real login.

## Runtime OIDC Env Boundary

`AGENTHUB_TDID_LOGIN_*` values are readiness metadata for scripts. Hub runtime
OIDC configuration still uses `AGENTHUB_TOKENDANCE_ID_ISSUER_URL`,
`AGENTHUB_TOKENDANCE_ID_CLIENT_ID`,
`AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET`, `AGENTHUB_TOKENDANCE_ID_REDIRECT_URI`,
and `AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS`.

The client secret remains outside Git and outside readiness artifacts.
