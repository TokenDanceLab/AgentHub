# AgentHub — CI / Pre-push Test Suite
# Usage: make test        (unit tests, no external deps)
#        make test-all    (all tests including integration)
#        make lint        (golangci-lint)
#        make coverage    (HTML coverage report)

#        make release VER=v0.1.1  (build + upload release binaries)
.PHONY: test test-all test-edge test-hub lint coverage sec release clean

# ── Unit tests (no external deps) ────────────────────

test: test-edge test-hub

test-edge:
	cd edge-server && go test ./... -short -count=1 -timeout 60s

test-hub:
	cd hub-server && go test ./... -short -count=1 -timeout 60s

# ── Full tests (requires Redis + PG) ─────────────────

test-all: test-edge-full test-hub-full

test-edge-full:
	cd edge-server && go test ./... -count=1 -timeout 120s -race

test-hub-full:
	cd hub-server && go test ./... -count=1 -timeout 120s

# ── Benchmarks ───────────────────────────────────

bench:
	cd edge-server && go test -bench=. -benchmem ./internal/events/
	cd hub-server && go test -bench=. -benchmem ./internal/service/

# ── Lint ─────────────────────────────────────────

lint:
	cd edge-server && golangci-lint run ./...
	cd hub-server && golangci-lint run ./...

# ── Coverage ─────────────────────────────────────

coverage:
	cd edge-server && go test ./... -short -coverprofile=coverage.out && go tool cover -html=coverage.out -o coverage.html
	cd hub-server && go test ./... -short -coverprofile=coverage.out && go tool cover -func=coverage.out

# ── Security ─────────────────────────────────────

sec:
	cd edge-server && gosec ./...
	cd hub-server && gosec ./...
	cd edge-server && govulncheck ./...
	cd hub-server && govulncheck ./...

# ── All checks (CI pipeline) ─────────────────────

ci: test lint sec

# ── Release ─────────────────────────────────────

release:
	@if [ -z "$(VER)" ]; then echo "Usage: make release VER=v0.1.1"; exit 1; fi
	powershell -File scripts/release.ps1 $(VER)

# ── Clean ────────────────────────────────────────

clean:
	cd edge-server && go clean -testcache
	cd hub-server && go clean -testcache
	rm -f edge-server/coverage.out edge-server/coverage.html
	rm -f hub-server/coverage.out hub-server/coverage.html
