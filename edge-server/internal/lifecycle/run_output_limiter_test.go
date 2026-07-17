package lifecycle

import "testing"

func TestRunOutputLimiterAllowAndTruncate(t *testing.T) {
	t.Parallel()

	l := newRunOutputLimiter(5)
	allowed, truncatedNow, written, maxBytes := l.allow([]byte("abc"))
	if string(allowed) != "abc" || truncatedNow || written != 3 || maxBytes != 5 {
		t.Fatalf("first allow: allowed=%q truncated=%v written=%d max=%d", allowed, truncatedNow, written, maxBytes)
	}

	allowed, truncatedNow, written, maxBytes = l.allow([]byte("defg"))
	if string(allowed) != "de" || !truncatedNow || written != 5 || maxBytes != 5 {
		t.Fatalf("second allow: allowed=%q truncated=%v written=%d max=%d", allowed, truncatedNow, written, maxBytes)
	}

	allowed, truncatedNow, written, _ = l.allow([]byte("more"))
	if allowed != nil || truncatedNow || written != 5 {
		t.Fatalf("third allow: allowed=%q truncated=%v written=%d", allowed, truncatedNow, written)
	}
}

func TestRunOutputLimiterDefaultMax(t *testing.T) {
	t.Parallel()

	l := newRunOutputLimiter(0)
	if l.maxBytes != defaultRunOutputMaxBytes {
		t.Fatalf("maxBytes = %d, want %d", l.maxBytes, defaultRunOutputMaxBytes)
	}
}
