# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────
# AgentHub Hub Server — Multi-stage Dockerfile
# Build context MUST be the repo root:
#   docker build -f hub-server/deployments/Dockerfile .
# ──────────────────────────────────────────────

# ═══════════════════════════════════════════════
# Stage 1: Build
# ═══════════════════════════════════════════════
FROM --platform=$BUILDPLATFORM golang:1.26.5-alpine AS builder
ARG TARGETOS TARGETARCH
WORKDIR /app

# Layer 1a: Go module cache — workspace config + all go.mod / go.sum
# These change rarely; Docker caches this layer aggressively.
COPY go.work go.work.sum ./
COPY pkg/go.mod ./pkg/go.mod
# pkg has no external deps → no go.sum; if one appears, add it here.
COPY edge-server/go.mod edge-server/go.sum ./edge-server/
COPY hub-server/go.mod hub-server/go.sum ./hub-server/
RUN cd hub-server && go mod download

# Layer 1b: Source code — changes frequently, but cache misses are
# cheap after go mod download is cached.
COPY pkg ./pkg
COPY hub-server ./hub-server

# Build: CGO disabled for fully static binary; -trimpath for
# reproducible builds; -s -w strips debug info & symbol table.
RUN cd hub-server && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o server-hub ./cmd/server-hub

# ═══════════════════════════════════════════════
# Stage 2: Runtime
# ═══════════════════════════════════════════════
FROM alpine:3.21

# Single RUN to minimise layers: upgrade base packages, install
# runtime deps (ca-certificates for TLS, tzdata for timezones,
# wget for HEALTHCHECK, tini as init process (reaps zombie children
# that Docker healthcheck injects into the PID namespace), configure
# nsswitch, create non-root user.
RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates tzdata wget tini \
    && echo "hosts: files dns" > /etc/nsswitch.conf \
    && adduser -D -h /app agenthub

WORKDIR /app

# Copy the static binary, config template, and migrations from the
# builder stage — no Go toolchain needed at runtime.
COPY --from=builder /app/hub-server/server-hub .
COPY --from=builder /app/hub-server/configs/config.docker.yaml ./configs/config.yaml
COPY --from=builder /app/hub-server/migrations ./migrations

# Entrypoint is copied from the build context (not the builder).
COPY hub-server/deployments/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Single RUN: set entrypoint executable and transfer ownership.
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && chown -R agenthub:agenthub /app

USER agenthub
EXPOSE 8080

# start-period=30s gives the server time to run migrations before
# the first health check fires.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["./server-hub"]
