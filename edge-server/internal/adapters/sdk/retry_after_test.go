package sdk

import (
	"net/http"
	"testing"
	"time"
)

func TestParseRetryAfterHeader(t *testing.T) {
	tests := []struct {
		name   string
		value  string
		want   time.Duration
		wantOK bool
	}{
		{"delta seconds", "3", 3 * time.Second, true},
		{"zero", "0", 0, true},
		{"negative rejected", "-5", 0, false},
		{"empty", "", 0, false},
		{"garbage", "soon", 0, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseRetryAfterHeader(tc.value)
			if ok != tc.wantOK || got != tc.want {
				t.Fatalf("parseRetryAfterHeader(%q) = (%v, %v), want (%v, %v)", tc.value, got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

func TestParseRetryAfterHeaderHTTPDate(t *testing.T) {
	future := time.Now().Add(10 * time.Second).UTC().Format(http.TimeFormat)
	got, ok := parseRetryAfterHeader(future)
	if !ok {
		t.Fatal("HTTP-date form must parse")
	}
	if got < 5*time.Second || got > 15*time.Second {
		t.Fatalf("HTTP-date delay = %v, want ~10s", got)
	}
	past := time.Now().Add(-time.Hour).UTC().Format(http.TimeFormat)
	got, ok = parseRetryAfterHeader(past)
	if !ok || got != 0 {
		t.Fatalf("past HTTP-date = (%v, %v), want (0, true)", got, ok)
	}
}

func TestRetryDelayWithHint(t *testing.T) {
	tests := []struct {
		name    string
		backoff time.Duration
		header  string
		want    time.Duration
	}{
		{"no header keeps backoff", 2 * time.Second, "", 2 * time.Second},
		{"hint below backoff keeps backoff", 4 * time.Second, "1", 4 * time.Second},
		{"hint above backoff wins", 1 * time.Second, "5", 5 * time.Second},
		{"hint capped at ceiling", 1 * time.Second, "120", retryAfterCeiling},
		{"garbage header keeps backoff", 2 * time.Second, "soon", 2 * time.Second},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := retryDelayWithHint(tc.backoff, tc.header); got != tc.want {
				t.Fatalf("retryDelayWithHint(%v, %q) = %v, want %v", tc.backoff, tc.header, got, tc.want)
			}
		})
	}
}
