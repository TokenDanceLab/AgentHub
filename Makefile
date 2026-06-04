# AgentHub — CI / Pre-push Test Suite
# Usage: make test        (unit tests, no external deps)
#        make test-all    (all tests including integration)
#        make lint        (golangci-lint)
#        make coverage    (HTML coverage report)
#        make fe-lint     (frontend eslint + stylelint)
#        make fe-build    (build all frontend packages)

#        make release VER=v0.1.1  (build + upload release binaries)
#        make help        (show this help)
.PHONY: test test-all test-edge test-hub lint coverage sec release clean fmt \
        fe-install fe-dev fe-build fe-test fe-lint fe-typecheck help

# ── Help ───────────────────────────────────────────

help:
	@echo "AgentHub Makefile targets:"
	@echo ""
	@echo "  Backend:"
	@echo "    test          单元测试 (edge + hub, -short)"
	@echo "    test-all      完整测试 (需 Redis + PG)"
	@echo "    test-edge     Edge Server 单元测试"
	@echo "    test-hub      Hub Server 单元测试"
	@echo "    lint          golangci-lint (edge + hub)"
	@echo "    coverage      覆盖率报告 (HTML + func)"
	@echo "    sec           gosec + govulncheck"
	@echo "    bench         Benchmark (events + service)"
	@echo "    ci            全量 CI: test + lint + sec"
	@echo "    clean         清理测试缓存和覆盖率文件"
	@echo ""
	@echo "  Frontend:"
	@echo "    fe-install    pnpm install"
	@echo "    fe-dev        pnpm dev (desktop :5173)"
	@echo "    fe-build      pnpm -r build (全部包)"
	@echo "    fe-test       pnpm -r test"
	@echo "    fe-lint       eslint + stylelint"
	@echo "    fe-typecheck  tsc --noEmit (desktop + web)"
	@echo ""
	@echo "  Release:"
	@echo "    release VER=v0.1.1   一键构建 + 上传"
	@echo ""

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

# ── Format ───────────────────────────────────────

fmt:
	cd edge-server && gofmt -w .
	cd hub-server && gofmt -w .

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

# ── Frontend ─────────────────────────────────────

fe-install:
	cd app && pnpm install

fe-dev:
	cd app && pnpm dev

fe-build:
	cd app && pnpm -r build

fe-test:
	cd app && pnpm -r test

fe-lint:
	cd app && pnpm -r lint
	cd app && pnpm lint:css

fe-typecheck:
	cd app/desktop && npx tsc --noEmit
	cd app/web && npx tsc --noEmit
