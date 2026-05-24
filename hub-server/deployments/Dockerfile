FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o server-hub ./cmd/server-hub

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/server-hub .
COPY --from=builder /app/configs/config.docker.yaml ./configs/config.yaml
COPY --from=builder /app/migrations ./migrations
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["./server-hub"]
