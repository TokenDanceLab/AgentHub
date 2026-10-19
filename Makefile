# AgentHub — CI / Pre-push Test Suite
# Usage: make test        (unit tests, no external deps)
#        make test-all    (all tests including integration)
#        make lint        (golangci-lint)
#        make coverage    (HTML coverage report)
#        make fe-lint     (frontend eslint + stylelint)
#        make fe-build    (build all frontend packages)

#        make release  (via git push tag -> release.yml, not built here)
#        make help        (show this help)
.PHONY: test test-ci test-all test-edge test-edge-full test-hub test-hub-full test-edge-e2e test-teamrun test-oidc test-hub-integration e2e-local lint coverage sec bench ci release clean fmt \
        fe-install fe-dev fe-build fe-test fe-test-changed fe-lint fe-typecheck help

# ── Help ───────────────────────────────────────────

help:
	@echo "AgentHub Makefile targets:"
	@echo ""
	@echo "  Backend:"
	@echo "    test          本地快速单元测试 (edge + hub, -short, 复用 Go test cache)"
	@echo "    test-ci       同 test，但 -count=1 绕过测试缓存（CI 语义）"
	@echo "    test-all      完整测试 (需 Redis + PG)"
	@echo "    test-edge     Edge Server 单元测试"
	@echo "    test-edge-e2e Edge→Hub 回调冒烟 (零外部依赖, 进程内 mock hub)"
	@echo "    test-hub      Hub Server 单元测试"
	@echo "    test-teamrun  团队编排 smoke (零外部依赖, in-memory sqlite)"
	@echo "    test-oidc     OIDC/scenarios smoke (零外部依赖)"
	@echo "    test-hub-integration  Hub 集成 lane (需 PG + Redis)"
	@echo "    e2e-local     零依赖 E2E 组合: edge-e2e + teamrun + oidc"
	@echo "    lint          golangci-lint (edge + hub)"
	@echo "    coverage      覆盖率报告 (HTML + func)"
	@echo "    sec           gosec + govulncheck"
	@echo "    bench         Benchmark (本地手动运行，不在 CI required check 内：events+adapters / service+jwtutil)"
	@echo "    ci            全量 CI: test + lint + sec"
	@echo "    clean         清理测试缓存和覆盖率文件"
	@echo ""
	@echo "  Frontend:"
	@echo "    fe-install    pnpm install"
	@echo "    fe-dev        pnpm dev (desktop :5173)"
	@echo "    fe-build      build web + desktop（mobile 为 Expo，无产物构建）"
	@echo "    fe-test       Vitest 单进程跑全部前端包（比 pnpm -r 更快）"
	@echo "    fe-test-changed  只跑受 git 变更影响的 Vitest 用例"
	@echo "    fe-lint       eslint + stylelint"
	@echo "    fe-typecheck  tsc --noEmit (desktop + web)"
	@echo ""
	@echo "  Release:"
	@echo "    release              发布 = git push tag（触发 release.yml）"
	@echo ""

# ── Unit tests (no external deps) ────────────────────

# 本地默认复用 Go test cache：未变化的包直接命中缓存。
# 需要与 CI 一致的干净结果时用 make test-ci（-count=1）。
test: test-edge test-hub

test-ci:
	$(MAKE) test-edge test-hub GO_TEST_FLAGS=-count=1

test-edge:
	cd edge-server && go test ./... -short $(GO_TEST_FLAGS) -timeout 60s

# Edge→Hub 回调冒烟：mock hub + 进程内 edge，零外部依赖（不需 PG/Redis/真实 CLI）。
# 覆盖 ack/stream/done/fail 直连回调链；-short 下这些用例会被跳过，故单独入口。
test-edge-e2e:
	cd edge-server && go test ./tests/ -count=1 -timeout 120s

test-hub:
	cd hub-server && go test ./... -short $(GO_TEST_FLAGS) -timeout 60s

# 零外部依赖的 E2E smoke（in-memory sqlite，无 build tag，CI 直跑）。
test-teamrun:
	cd hub-server && go test ./tests/teamrun/ -count=1 -timeout 60s

test-oidc:
	cd hub-server && go test ./tests/oidc/ ./tests/scenarios/ -count=1 -timeout 60s

# Hub 集成 lane（//go:build integration，需 PG + Redis service 容器）。
test-hub-integration:
	cd hub-server && go test -tags integration ./tests/integration/ -count=1 -timeout 300s

# 零依赖 E2E 组合（无需 PG/Redis/真实 CLI）。
e2e-local: test-edge-e2e test-teamrun test-oidc

# ── Full tests (requires Redis + PG) ─────────────────
# test-all 含 integration lane（//go:build integration，需 PG + Redis service 容器）。

test-all: test-edge-full test-hub-full test-hub-integration

test-edge-full:
	cd edge-server && go test ./... -count=1 -timeout 120s -race

test-hub-full:
	cd hub-server && go test ./... -count=1 -timeout 120s -race

# ── Benchmarks ───────────────────────────────────
# 本地手动运行，不在 CI required check 内。

bench:
	cd edge-server && go test -bench=. -benchmem ./internal/events/ ./internal/adapters/
	cd hub-server && go test -bench=. -benchmem ./internal/service/ ./internal/jwtutil/

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

# 唯一发布入口：git tag vX.Y.Z[-rc.N] → push → release.yml。
# 本地 make release 只提示入口并以 exit 1 失败，避免被误当作发布成功。
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
	# mobile-rn 是 Expo 开发构建（无产物 build script），只 build 有产物的 web/desktop
	cd app && pnpm --filter agenthub-web --filter agenthub-desktop build

# 单个 Vitest 进程调度全部 project，避免 pnpm -r 为每个包各起一套 worker。
fe-test:
	cd app && pnpm test

# 本地迭代用：只跑受工作区未提交/已提交变更影响的用例。
fe-test-changed:
	cd app && pnpm exec vitest run --changed

fe-lint:
	cd app && pnpm -r lint
	cd app && pnpm lint:css

fe-typecheck:
	cd app && pnpm --filter agenthub-desktop typecheck
	cd app && pnpm --filter agenthub-web typecheck
