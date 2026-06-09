# 08-Build/DevEx Cross-Review

> Cross-Reviewer: independent verification | Date: 2026-06-07 | Method: source-code audit against build-devex-audit findings

---

## Verification of Critical (RED) Findings

### B-1: TypeScript `exactOptionalPropertyTypes` inconsistency across projects

**Verdict: ✅ Confirmed**

Verified values:

| Project | `exactOptionalPropertyTypes` | Source |
|---------|------------------------------|--------|
| web | `true` | `app/web/tsconfig.json:10` |
| desktop | `false` | `app/desktop/tsconfig.json:9` |
| shared | `false` | `app/shared/tsconfig.json:9` |
| mobile | (not set) | `app/mobile/tsconfig.json` -- absent entirely |

When `exactOptionalPropertyTypes` is `true` (web), a property typed as `foo?: string` can only be assigned `string | undefined`, NOT `null` or omitted with a different type. When `false` (desktop/shared), it can be `string | undefined` implicitly. This creates a real type-signature mismatch when shared code is consumed by both web and desktop projects.

The mobile project not setting it at all means it defaults to `false`, which is consistent with desktop/shared but inconsistent with web.

**Assessment:** This is a real configuration inconsistency. It is unlikely to cause runtime bugs in practice (TypeScript catches it at compile time), but it does cause friction when shared types behave differently across projects.

### B-2: `tauri.conf.json` version (0.2.0) vs `Cargo.toml` version (0.1.0) mismatch

**Verdict: ✅ Confirmed**

Source:
- `app/desktop/src-tauri/tauri.conf.json:4`: `"version": "0.2.0"`
- `app/desktop/src-tauri/Cargo.toml:3`: `version = "0.1.0"`

These two version numbers should always be synchronized. The Tauri build uses `tauri.conf.json` for the installer/package version, while `Cargo.toml` is the Rust crate version. A mismatch means:
- The Tauri installer will report version 0.2.0
- The Cargo metadata will report 0.1.0
- Any automated version bumping script that only updates one file will be out of sync

This is a genuine issue that should be fixed and automated.

---

## Verification of Warning (YELLOW) Findings

### B-3: Vite config duplication across desktop/web/mobile

**Verdict: ✅ Confirmed**

Verified:
- Desktop `vite.config.ts`: has `dedupe`, `manualChunks` (5 groups), `alias` (6 entries), `minify`, `sourcemap`
- Web `vite.config.ts`: has `dedupe`, `manualChunks` (3 groups), `alias` (6 entries), no `minify`, no `sourcemap`
- Mobile `vite.config.ts`: no `dedupe`, no `manualChunks`, `alias` (2 entries only), no `minify`, no `sourcemap`

The alias pattern for `@shared` is repeated in desktop and web. Mobile uses `@agenthub/shared` instead. The dedupe and manualChunks patterns are copy-pasted with variations. Finding is real.

### B-4: tsconfig scattered without inheritance

**Verdict: ✅ Confirmed**

No `app/tsconfig.base.json` exists. Each sub-project defines its own `compilerOptions` from scratch. While they share many common settings (`target: ES2021`, `strict: true`, etc.), there is no inheritance chain. The report's suggestion to create a base config is valid.

### B-5: Dependency version inconsistencies across sub-projects

**Verdict: ✅ Confirmed**

Verified specific examples:
- React: desktop/web `^19.2.7`, mobile `^19.1.0` -- semver-compatible but not identical
- `@tauri-apps/api`: desktop `^2.11.0`, mobile `^2.5.0` -- significant difference (6 minor versions)
- Both are real inconsistencies

### B-6: Mobile missing `noUncheckedIndexedAccess`

**Verdict: ✅ Confirmed**

`app/mobile/tsconfig.json` does not include `noUncheckedIndexedAccess`. Desktop, web, and shared all have it set to `true`. This means array indexing `arr[0]` returns `T` in mobile but `T | undefined` in other projects. Finding is real.

### B-7: Desktop has 5 CI vitest configs

**Verdict: ✅ Confirmed**

Files found:
1. `vitest.desktop-ci.config.ts`
2. `vitest.desktop-ts-ci.config.ts`
3. `vitest.desktop-tsx-ci.config.ts`
4. `vitest.edge-integration-ci.config.ts`
5. `vitest.shared-ci.config.ts`

Plus the base `vitest.config.ts`. That is 5 CI configs as stated. The maintenance burden concern is valid.

### B-8: Edge-server no independent Makefile

**Verdict: ✅ Confirmed**

No `edge-server/Makefile` found. Hub-server has `hub-server/Makefile`. The root `Makefile` exists. Finding is real.

### B-9: Edge-server gosec not enabled

**Verdict: ✅ Confirmed**

- `hub-server/.golangci.yml`: contains `gosec` under linters
- `edge-server/.golangci.yml`: no `gosec` found

However, the CI workflow (`checks.yml`) runs `gosec@latest` as a separate step for both edge and hub, so gosec IS applied to edge-server in CI, just not via golangci-lint. **The report's finding about the config file is correct, but the practical impact is lower than implied because CI runs gosec separately.**

### B-10: golangci-lint CI marked `continue-on-error: true`

**Verdict: ✅ Confirmed**

Found at `.github/workflows/checks.yml`:
- Line 35: edge-server lint step has `continue-on-error: true`
- Line 127 (approx): hub-server lint step also has `continue-on-error: true`
- Additional `continue-on-error` entries exist for gosec and govulncheck steps

The report's concern is valid -- lint failures do not block PRs.

### B-11: CI uses `@latest` for gosec/govulncheck

**Verdict: ✅ Confirmed**

Found at `.github/workflows/checks.yml`:
- `go run github.com/securego/gosec/v2/cmd/gosec@latest ./...`
- `go run golang.org/x/vuln/cmd/govulncheck@latest ./...`

These appear in multiple CI jobs (edge and hub). Using `@latest` means:
- Builds are not reproducible
- A new major version could break CI without warning
- However, the `GOLANGCI_LINT_VERSION` IS pinned (`v2.12.2`) -- it's only gosec and govulncheck that use `@latest`

### B-12: Mobile Vite missing `manualChunks`/`dedupe`

**Verdict: ✅ Confirmed**

`app/mobile/vite.config.ts` has:
- No `dedupe` option
- No `manualChunks` under `rollupOptions`
- Only 2 alias entries (`@` and `@agenthub/shared`)

Finding is real. Mobile production builds may have larger bundle sizes.

### B-13: Web Vite missing some vendor chunk splits

**Verdict: ✅ Confirmed**

Web `manualChunks`:
```js
'vendor-react': ['react', 'react-dom'],
'vendor-ui': ['lucide-react'],
'vendor-i18n': ['i18next', 'react-i18next'],
```

Desktop `manualChunks` adds:
```js
'vendor-tanstack': ['@tanstack/react-query', '@tanstack/react-virtual'],
'vendor-markdown': ['react-markdown', 'remark-gfm', 'react-syntax-highlighter'],
```

Web does indeed lack the `vendor-tanstack` and `vendor-markdown` splits. Finding is real, though the impact depends on whether web uses these libraries.

### B-14: Shared lint script incomplete

**Verdict: ✅ Confirmed**

`app/shared/package.json` has `"lint": "tsc --noEmit"`. This only checks TypeScript compilation, not ESLint rules (formatting, best practices, etc.). Finding is real.

### B-15: WebSocket libraries not unified (gorilla vs coder)

**Verdict: ✅ Confirmed**

- `edge-server/go.mod`: `github.com/gorilla/websocket v1.5.3`
- `hub-server/go.mod`: `github.com/coder/websocket v1.8.14`

Two different WebSocket libraries in the same monorepo. `gorilla/websocket` is the older, widely-used library. `coder/websocket` (formerly `nhooyr.io/websocket`) is a maintained fork. The report's suggestion to unify is reasonable but this is low priority.

---

## Additional Verification: Cargo.lock

The report states "没有 Cargo.lock 的检查" and suggests confirming Cargo.lock is committed.

**Verdict: ❌ Misleading concern**

`app/desktop/src-tauri/Cargo.lock` exists and is tracked in git:
```
$ git ls-files app/desktop/src-tauri/Cargo.lock
app/desktop/src-tauri/Cargo.lock
```

The Cargo.lock IS committed. The report's phrasing was cautious ("缺失: 没有 Cargo.lock 的检查") but could be read as implying it's missing. It is not missing.

---

## Summary Table

| # | Finding | Level | Verdict | Notes |
|---|---------|-------|---------|-------|
| B-1 | `exactOptionalPropertyTypes` inconsistent | 🔴 | ✅ Confirmed | web=true, desktop/shared=false, mobile=unset |
| B-2 | tauri.conf.json vs Cargo.toml version mismatch | 🔴 | ✅ Confirmed | 0.2.0 vs 0.1.0 |
| B-3 | Vite config duplication | 🟡 | ✅ Confirmed | |
| B-4 | tsconfig no base inheritance | 🟡 | ✅ Confirmed | |
| B-5 | Dependency version drift | 🟡 | ✅ Confirmed | React 19.2.7 vs 19.1.0; Tauri API 2.11 vs 2.5 |
| B-6 | Mobile missing `noUncheckedIndexedAccess` | 🟡 | ✅ Confirmed | |
| B-7 | 5 desktop CI vitest configs | 🟡 | ✅ Confirmed | |
| B-8 | Edge-server no Makefile | 🟡 | ✅ Confirmed | |
| B-9 | Edge-server gosec not in golangci.yml | 🟡 | ⚠️ Partially Accurate | gosec runs in CI separately, config gap is real but practical impact lower |
| B-10 | golangci-lint `continue-on-error: true` | 🟡 | ✅ Confirmed | |
| B-11 | gosec/govulncheck `@latest` | 🟡 | ✅ Confirmed | |
| B-12 | Mobile Vite no chunks/dedupe | 🟡 | ✅ Confirmed | |
| B-13 | Web Vite missing vendor splits | 🟡 | ✅ Confirmed | |
| B-14 | Shared lint = tsc only | 🟡 | ✅ Confirmed | |
| B-15 | WebSocket library divergence | 🟡 | ✅ Confirmed | gorilla vs coder |
| -- | Cargo.lock missing | -- | ❌ Misleading | Cargo.lock exists and is tracked in git |

**Overall assessment:** Both RED findings are confirmed as real. The version mismatch (B-2) is the most operationally impactful finding. All YELLOW findings are confirmed with one qualification: the edge gosec finding (B-9) has lower practical impact because gosec runs separately in CI. The Cargo.lock concern is a false alarm -- the file exists and is tracked.
