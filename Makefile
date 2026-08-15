# AgentHub — CI / Pre-push Test Suite
# Usage: make test        (unit tests, no external deps)
#        make test-all    (all tests including integration)
#        make lint        (golangci-lint)
#        make coverage    (HTML coverage report)
#        make fe-lint     (frontend eslint + stylelint)
#        make fe-build    (build all frontend packages)

#        make release  (via git push tag -> release.yml, not built here)
#        make help        (show this help)
.PHONY: test test-all test-edge test-hub test-edge-e2e lint coverage sec release clean fmt \
        fe-install fe-dev fe-build fe-test fe-lint fe-typecheck help

# ── Help ───────────────────────────────────────────

help:
	@echo "AgentHub Makefile targets:"
	@echo ""
	@echo "  Backend:"
	@echo "    test          单元测试 (edge + hub, -short)"
	@echo "    test-all      完整测试 (需 Redis + PG)"
	@echo "    test-edge     Edge Server 单元测试"
	@echo "    test-edge-e2e Edge→Hub 回调冒烟 (零外部依赖, 进程内 mock hub)"
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
	@echo "    release              发布 = git push tag（触发 release.yml）"
	@echo ""

# ── Unit tests (no external deps) ────────────────────

test: test-edge test-hub

test-edge:
	cd edge-server && go test ./... -short -count=1 -timeout 60s

# Edge→Hub 回调冒烟：mock hub + 进程内 edge，零外部依赖（不需 PG/Redis/真实 CLI）。
# 覆盖 ack/stream/done/fail 直连回调链；-short 下这些用例会被跳过，故单独入口。
test-edge-e2e:
	cd edge-server && go test ./tests/ -count=1 -run "^TestHubE2E_" -timeout 120s

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

# 发布入口已收敛（2026-08-02）：唯一入口 = git tag vX.Y.Z[-rc.N] → push → release.yml（AGENTS.md §12）。
# release.ps1 已删除；本地不再上传二进制。本地 `make release` 不再假绿灯
# （审计）：它只提醒走 release.yml 并以 exit 1 失败，避免被误当作发布成功。
release:
	@echo "release is via git push tag -> release.yml" >&2; exit 1

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
