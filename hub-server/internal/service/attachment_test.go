package service

import (
	"strings"
	"testing"
)

func TestPathFromHashValidatesHashShape(t *testing.T) {
	validHash := strings.Repeat("a", 64)
	if got, want := PathFromHash(validHash), "uploads/aa/aa/"+validHash; got != want {
		t.Fatalf("PathFromHash valid hash = %q, want %q", got, want)
	}

	for _, hash := range []string{
		"",
		"abc",
		strings.Repeat("g", 64),
		strings.Repeat("A", 64),
	} {
		t.Run(hash, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("PathFromHash(%q) panicked: %v", hash, r)
				}
			}()
			if got := PathFromHash(hash); got != "" {
				t.Fatalf("PathFromHash(%q) = %q, want empty path", hash, got)
			}
		})
	}
}
