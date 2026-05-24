FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o server-hub ./cmd/server-hub

FROM alpine:3.21
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates tzdata wget
RUN adduser -D -h /app agenthub
WORKDIR /app
COPY --from=builder /app/server-hub .
COPY --from=builder /app/configs/config.docker.yaml ./configs/config.yaml
COPY --from=builder /app/migrations ./migrations
RUN chown -R agenthub:agenthub /app
USER agenthub
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["./server-hub"]
