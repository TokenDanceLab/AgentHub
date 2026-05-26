package adapters

import (
	"bufio"
	"context"
	"io"
)

const (
	adapterScannerInitialBufferSize = 256 * 1024
	adapterScannerMaxTokenSize      = 10 * 1024 * 1024
)

func configureAdapterScanner(scanner *bufio.Scanner) {
	scanner.Buffer(make([]byte, 0, adapterScannerInitialBufferSize), adapterScannerMaxTokenSize)
}

// LineHandler is called for each non-empty line from the scanner.
// The line bytes are owned by the scanner and must not be retained across calls.
type LineHandler func(line []byte) error

// ScanLines reads lines from r using a bufio.Scanner, calling handler for each
// non-empty line. It respects ctx cancellation and returns scanner.Err() on EOF.
// This is the common scanner loop shared by Codex, OpenCode, and NDJSONStreamParser.
func ScanLines(ctx context.Context, r io.Reader, handler LineHandler) error {
	scanner := bufio.NewScanner(r)
	configureAdapterScanner(scanner)

	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		if err := handler(line); err != nil {
			return err
		}
	}
	return scanner.Err()
}
