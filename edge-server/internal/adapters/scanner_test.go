package adapters

import (
	"bufio"
	"bytes"
	"context"
	"strings"
	"testing"
	"time"
)

// TestConfigureAdapterScanner tests that configureAdapterScanner sets up a
// scanner with a non-zero buffer.
func TestConfigureAdapterScanner(t *testing.T) {
	scanner := bufio.NewScanner(strings.NewReader("test"))
	configureAdapterScanner(scanner)

	// Verify the buffer is configured by scanning a line.
	if !scanner.Scan() {
		t.Fatal("scanner should scan the test input")
	}
	if scanner.Text() != "test" {
		t.Errorf("scanned text = %q, want test", scanner.Text())
	}
}

// TestScanLinesSingleLine tests scanning a single line.
func TestScanLinesSingleLine(t *testing.T) {
	input := strings.NewReader("hello world\n")
	var lines []string
	err := ScanLines(context.Background(), input, func(line []byte) error {
		lines = append(lines, string(line))
		return nil
	})
	if err != nil {
		t.Fatalf("ScanLines error: %v", err)
	}
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	if lines[0] != "hello world" {
		t.Errorf("line = %q, want hello world", lines[0])
	}
}

// TestScanLinesMultipleLines tests scanning multiple lines.
func TestScanLinesMultipleLines(t *testing.T) {
	input := strings.NewReader("line1\nline2\nline3\n")
	var lines []string
	err := ScanLines(context.Background(), input, func(line []byte) error {
		lines = append(lines, string(line))
		return nil
	})
	if err != nil {
		t.Fatalf("ScanLines error: %v", err)
	}
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d: %v", len(lines), lines)
	}
	if lines[0] != "line1" || lines[1] != "line2" || lines[2] != "line3" {
		t.Errorf("lines = %v, want [line1 line2 line3]", lines)
	}
}

// TestScanLinesEmptyLinesAreSkipped tests that blank lines are skipped.
func TestScanLinesEmptyLinesAreSkipped(t *testing.T) {
	input := strings.NewReader("line1\n\n\nline2\n\n")
	var lines []string
	err := ScanLines(context.Background(), input, func(line []byte) error {
		lines = append(lines, string(line))
		return nil
	})
	if err != nil {
		t.Fatalf("ScanLines error: %v", err)
	}
	if len(lines) != 2 {
		t.Fatalf("expected 2 non-empty lines, got %d: %v", len(lines), lines)
	}
	if lines[0] != "line1" || lines[1] != "line2" {
		t.Errorf("lines = %v", lines)
	}
}

// TestScanLinesEmptyInput tests scanning empty input.
func TestScanLinesEmptyInput(t *testing.T) {
	input := strings.NewReader("")
	var count int
	err := ScanLines(context.Background(), input, func(line []byte) error {
		count++
		return nil
	})
	if err != nil {
		t.Fatalf("ScanLines error: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 lines from empty input, got %d", count)
	}
}

// TestScanLinesOnlyEmptyLines tests scanning input that contains only empty lines.
func TestScanLinesOnlyEmptyLines(t *testing.T) {
	input := strings.NewReader("\n\n\n")
	var count int
	err := ScanLines(context.Background(), input, func(line []byte) error {
		count++
		return nil
	})
	if err != nil {
		t.Fatalf("ScanLines error: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 lines from empty-only input, got %d", count)
	}
}

// TestScanLinesHandlerError tests that a handler error stops scanning.
func TestScanLinesHandlerError(t *testing.T) {
	input := strings.NewReader("line1\nline2\nline3\n")
	var lines []string
	err := ScanLines(context.Background(), input, func(line []byte) error {
		lines = append(lines, string(line))
		if len(lines) >= 2 {
			return context.DeadlineExceeded // any error stops scanning
		}
		return nil
	})
	if err == nil {
		t.Fatal("expected error from handler, got nil")
	}
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines before error, got %d", len(lines))
	}
}

// TestScanLinesCanceledContext tests that a canceled context stops scanning.
func TestScanLinesCanceledContext(t *testing.T) {
	input := strings.NewReader("line1\nline2\nline3\n")
	ctx, cancel := context.WithCancel(context.Background())

	var count int
	errCh := make(chan error, 1)
	go func() {
		errCh <- ScanLines(ctx, input, func(line []byte) error {
			count++
			cancel() // cancel on first line so next Scan checks ctx
			return nil
		})
	}()

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("expected error from canceled context, got nil")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for ScanLines to return")
	}
}

// TestScanLinesAlreadyCancelled tests that an already-cancelled context returns immediately.
func TestScanLinesAlreadyCancelled(t *testing.T) {
	input := bytes.NewReader([]byte("line1\nline2\n"))
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel before starting

	var count int
	err := ScanLines(ctx, input, func(line []byte) error {
		count++
		return nil
	})
	if err == nil {
		t.Fatal("expected error from cancelled context, got nil")
	}
	// May process 0 or 1 line depending on timing, but must error
}

// TestScanLinesWithCRLF tests scanning with Windows-style line endings.
func TestScanLinesWithCRLF(t *testing.T) {
	input := strings.NewReader("line1\r\nline2\r\nline3\r\n")
	var lines []string
	err := ScanLines(context.Background(), input, func(line []byte) error {
		lines = append(lines, string(line))
		return nil
	})
	if err != nil {
		t.Fatalf("ScanLines error: %v", err)
	}
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d: %v", len(lines), lines)
	}
}

// TestScanLinesLargeLine tests scanning a line larger than the initial buffer.
func TestScanLinesLargeLine(t *testing.T) {
	// Create a line larger than the initial 256KB buffer
	largeLine := strings.Repeat("A", 300*1024) // 300KB > 256KB initial buffer
	input := strings.NewReader(largeLine + "\n")
	var lines []string
	err := ScanLines(context.Background(), input, func(line []byte) error {
		lines = append(lines, string(line))
		return nil
	})
	if err != nil {
		t.Fatalf("ScanLines error: %v", err)
	}
	if len(lines) != 1 {
		t.Fatalf("expected 1 large line, got %d", len(lines))
	}
	if len(lines[0]) != len(largeLine) {
		t.Errorf("large line length mismatch: got %d, want %d", len(lines[0]), len(largeLine))
	}
}

// TestScanLinesTableDriven runs table-driven tests for various input patterns.
func TestScanLinesTableDriven(t *testing.T) {
	cases := []struct {
		name     string
		input    string
		want     []string
		wantErr  bool
	}{
		{"single line", "hello\n", []string{"hello"}, false},
		{"multiple lines", "a\nb\nc\n", []string{"a", "b", "c"}, false},
		{"with blank lines", "a\n\nb\n\nc\n", []string{"a", "b", "c"}, false},
		{"trailing blank", "a\nb\n\n", []string{"a", "b"}, false},
		{"leading blank", "\n\na\nb\n", []string{"a", "b"}, false},
		{"all blank", "\n\n\n", nil, false},
		{"empty", "", nil, false},
		{"no newline at end", "hello", []string{"hello"}, false},
		{"CRLF", "a\r\nb\r\n", []string{"a", "b"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var lines []string
			err := ScanLines(context.Background(), strings.NewReader(tc.input), func(line []byte) error {
				lines = append(lines, string(line))
				return nil
			})
			if tc.wantErr && err == nil {
				t.Error("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			if len(lines) != len(tc.want) {
				t.Errorf("lines count = %d, want %d: %v", len(lines), len(tc.want), lines)
				return
			}
			for i := range tc.want {
				if lines[i] != tc.want[i] {
					t.Errorf("line[%d] = %q, want %q", i, lines[i], tc.want[i])
				}
			}
		})
	}
}
