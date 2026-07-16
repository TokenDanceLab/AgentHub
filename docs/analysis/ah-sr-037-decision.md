# AH-SR-037 decision (#438)

最后更新：2026-07-16

## Decision

**Accept current Web tab-scoped `sessionStorage` Hub session storage** for cleanup-baseline, with compensating controls. BFF/HttpOnly remains a future enhancement, not a hard close for this program.

## Why

- Product Web already intentionally avoids `localStorage` persistence for Hub tokens.
- Full BFF/HttpOnly is a multi-PR architecture change (cookie domain, CSRF, Hub session owner) outside strangler cleanup slices.
- Public release still blocked by other High items; this Accepted record makes the residual explicit.

## Compensating controls

1. Production Web only over HTTPS
2. Short-lived access token + refresh rotation
3. CSP / XSS hygiene on Web workbench
4. AH-SR-043: no silent demo success outside explicit mock/fixture
5. Tokens never logged or placed in URLs

## Revisit triggers

- Public Web XSS incident
- Requirement for long-lived untrusted-device browser sessions
- Cookie session SSO product requirement
