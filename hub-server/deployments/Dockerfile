FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.work ./
COPY pkg/go.mod ./pkg/go.mod
COPY edge-server/go.mod edge-server/go.sum ./edge-server/
COPY hub-server/go.mod hub-server/go.sum ./hub-server/
RUN cd hub-server && go mod download
COPY pkg ./pkg
COPY hub-server ./hub-server
RUN cd hub-server && CGO_ENABLED=0 go build -ldflags="-s -w" -o server-hub ./cmd/server-hub

FROM alpine:3.21
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates tzdata wget
RUN echo "hosts: files dns" > /etc/nsswitch.conf
RUN adduser -D -h /app agenthub
WORKDIR /app
COPY --from=builder /app/hub-server/server-hub .
COPY --from=builder /app/hub-server/configs/config.docker.yaml ./configs/config.yaml
COPY --from=builder /app/hub-server/migrations ./migrations
RUN chown -R agenthub:agenthub /app
USER agenthub
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["./server-hub"]
