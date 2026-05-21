# AgentHub Go Module 初始化 + CI/CD + 构建配置

> 基于 design-go-services.md + web-research-tech-stack.md
> 所有文件可直接复制使用

## 1. go.mod

```go
module github.com/TokenDanceLab/AgentHub

go 1.24.0

require (
    // WebSocket — gorilla 已归档, coder/websocket 持续维护, 并发写安全
    github.com/coder/websocket v1.8.6

    // SQLite — 纯 Go 无 CGO, FTS5 内置, 跨平台编译
    modernc.org/sqlite v1.38.0

    // Protobuf — Buf 生成的 Go 代码依赖
    google.golang.org/protobuf v1.37.0

    // Connect-RPC — gRPC/gRPC-Web/Connect 三协议
    connectrpc.com/connect v1.19.0

    // SSH — 远程 Runner transport
    golang.org/x/crypto v0.35.0

    // 迁移
    github.com/golang-migrate/migrate/v4 v4.18.2

    // 压缩 — Snapshot zstd
    github.com/klauspost/compress v1.18.0

    // YAML — Agent 配置
    gopkg.in/yaml.v3 v3.0.1

    // CLI — agenthub 命令行
    github.com/spf13/cobra v1.9.1

    // 配置管理
    github.com/spf13/viper v1.20.0
)
```

## 2. .gitignore（追加）

```gitignore
# Go workspace (local dev only)
go.work
go.work.sum

# Build output
/bin/
/dist/
/services/hub/hub
/services/edge/edge
/services/runner/runner

# Generated code
gen/
*.generated.go

# IDE
.idea/
.vscode/
*.swp
```

## 3. Makefile

```makefile
.PHONY: all build test lint gen dev clean

# ---- Build ----
build: build-hub build-edge build-runner

build-hub:
	go build -o bin/hub ./services/hub/cmd/main.go

build-edge:
	go build -o bin/edge ./services/edge/cmd/main.go

build-runner:
	go build -o bin/runner ./services/runner/cmd/main.go

# ---- Dev (本地开发) ----
dev:
	go run ./services/hub/cmd/main.go &
	go run ./services/edge/cmd/main.go &
	go run ./services/runner/cmd/main.go &
	cd apps/web && pnpm dev

# ---- Test ----
test:
	go test ./... -v -count=1

test-race:
	go test ./... -race -count=1

# ---- Lint ----
lint:
	golangci-lint run ./...

# ---- Codegen ----
gen: gen-proto gen-sdk-types

gen-proto:
	buf generate proto/

gen-sdk-types:
	go run ./scripts/generate-sdk-types.go

# ---- DB ----
migrate-up:
	go run ./scripts/migrate.go up

migrate-down:
	go run ./scripts/migrate.go down

migrate-new:
	go run ./scripts/migrate.go new $(NAME)

# ---- Clean ----
clean:
	rm -rf bin/ gen/
```

## 4. .golangci.yml

```yaml
linters:
  enable:
    - errcheck
    - gosimple
    - govet
    - ineffassign
    - staticcheck
    - unused
    - gofmt
    - goimports
    - misspell
    - revive
    - unconvert
    - unparam

linters-settings:
  revive:
    rules:
      - name: exported
        severity: warning
        disabled: false

issues:
  exclude-use-default: false
  max-issues-per-linter: 0
  max-same-issues: 0
```

## 5. buf.yaml

```yaml
version: v2
modules:
  - path: proto
lint:
  use:
    - DEFAULT
breaking:
  use:
    - FILE
```

## 6. buf.gen.yaml

```yaml
version: v2
managed:
  enabled: true
  override:
    - file_option: go_package_prefix
      value: github.com/TokenDanceLab/AgentHub/gen/go

plugins:
  - remote: buf.build/protocolbuffers/go:v1.37.0
    out: gen/go
    opt:
      - paths=source_relative
  - remote: buf.build/connectrpc/go:v1.19.0
    out: gen/go
    opt:
      - paths=source_relative
  - remote: buf.build/bufbuild/es:v2.2.3
    out: gen/ts
    opt:
      - target=ts
```

## 7. .github/workflows/ci.yml

```yaml
name: CI
on:
  push:
    branches: [master, main]
  pull_request:
    branches: [master, main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.24' }
      - uses: golangci/golangci-lint-action@v6
        with: { version: latest }

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.24' }
      - run: go test ./... -race -count=1

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.24' }
      - run: |
          go build -o bin/hub ./services/hub/cmd/main.go
          go build -o bin/edge ./services/edge/cmd/main.go
          go build -o bin/runner ./services/runner/cmd/main.go

  buf-breaking:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: bufbuild/buf-action@v1
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

## 8. SQLite 迁移脚本 (`scripts/migrate.go`)

```go
package main

import (
    "database/sql"
    "embed"
    "fmt"
    "os"

    "github.com/golang-migrate/migrate/v4"
    "github.com/golang-migrate/migrate/v4/database/sqlite3"
    "github.com/golang-migrate/migrate/v4/source/iofs"
    _ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

func main() {
    db, err := sql.Open("sqlite", os.Getenv("AGENTHUB_DB_PATH"))
    if err != nil {
        panic(err)
    }
    defer db.Close()

    source, err := iofs.New(migrations, "migrations")
    if err != nil {
        panic(err)
    }

    driver, err := sqlite3.WithInstance(db, &sqlite3.Config{})
    if err != nil {
        panic(err)
    }

    m, err := migrate.NewWithInstance("iofs", source, "sqlite3", driver)
    if err != nil {
        panic(err)
    }

    cmd := os.Args[1]
    switch cmd {
    case "up":
        m.Up()
    case "down":
        m.Down()
    default:
        fmt.Println("usage: migrate [up|down]")
    }
}
```

## 9. 目录结构终版

```
AgentHub/
├── go.mod
├── go.sum
├── go.work                    # gitignored
├── Makefile
├── buf.yaml
├── buf.gen.yaml
├── .golangci.yml
├── .gitignore
├── .github/workflows/ci.yml
├── proto/agenthub/v1/*.proto
├── gen/go/                    # Buf 生成
├── gen/ts/                    # Buf 生成
├── services/
│   ├── hub/cmd/main.go
│   ├── edge/cmd/main.go
│   └── runner/cmd/main.go
├── packages/
│   ├── protocol/
│   ├── transport/
│   ├── im-core/
│   ├── agent-core/
│   ├── workspace-core/
│   ├── approval-core/
│   ├── sync-core/
│   ├── memory-core/
│   ├── artifact-core/
│   └── adapters/
├── apps/web/
├── scripts/migrate.go
└── docs/
```
