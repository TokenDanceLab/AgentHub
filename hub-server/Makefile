.PHONY: build test test-all test-cover lint dev run migrate-up migrate-down clean help

APP_NAME := server-hub
CMD_DIR  := ./cmd/server-hub

## build: compile the hub server binary
build:
	go build -o $(APP_NAME) $(CMD_DIR)

## test: run tests in short mode (skip integration)
test:
	go test ./... -short -count=1

## test-all: run all tests including integration
test-all:
	go test ./... -count=1

## test-cover: run tests with coverage report
test-cover:
	go test ./... -short -coverprofile=coverage.out -count=1
	go tool cover -func=coverage.out
	go tool cover -html=coverage.out -o coverage.html

## lint: run golangci-lint
lint:
	golangci-lint run ./...

## dev: start the server for local development (auto-runs pending migrations)
dev:
	go run $(CMD_DIR)

## run: build and run the server binary (auto-runs pending migrations)
run: build
	./$(APP_NAME)

## clean: remove build artifacts
clean:
	rm -f $(APP_NAME) coverage.out coverage.html

## help: show this help
help:
	@grep -E '^##' $(MAKEFILE_LIST) | sed 's/^## //'
