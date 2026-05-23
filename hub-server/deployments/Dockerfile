FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o server-hub ./cmd/server-hub

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/server-hub .
COPY --from=builder /app/configs/config.docker.yaml ./configs/config.yaml
COPY --from=builder /app/migrations ./migrations
EXPOSE 8080
CMD ["./server-hub"]
