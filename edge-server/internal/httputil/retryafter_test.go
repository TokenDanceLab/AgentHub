package httputil

import (
	"net/http"
	"testing"
	"time"
)

// sdkCeiling and callbackCeiling mirror the two real call sites
// (internal/adapters/sdk passes 30s, internal/hub passes NoCeiling). They are
// restated here so the divergence between the two callers is asserted in one
// place, on identical input, instead of being implied by two packages'
// defaults (#2244).
const (
	sdkCeiling      = 30 * time.Second
	callbackCeiling = NoCeiling
)

func TestParseRetryAfter(t *testing.T) {
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
		{"whitespace only", "   ", 0, false},
		{"surrounding whitespace tolerated", " 7 ", 7 * time.Second, true},
		{"garbage", "soon", 0, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ParseRetryAfter(tc.value)
			if ok != tc.wantOK || got != tc.want {
				t.Fatalf("ParseRetryAfter(%q) = (%v, %v), want (%v, %v)", tc.value, got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

func TestParseRetryAfterHTTPDate(t *testing.T) {
	future := time.Now().Add(10 * time.Second).UTC().Format(http.TimeFormat)
	got, ok := ParseRetryAfter(future)
	if !ok {
		t.Fatal("HTTP-date form must parse")
	}
	if got < 5*time.Second || got > 15*time.Second {
		t.Fatalf("HTTP-date delay = %v, want ~10s", got)
	}
	past := time.Now().Add(-time.Hour).UTC().Format(http.TimeFormat)
	got, ok = ParseRetryAfter(past)
	if !ok || got != 0 {
		t.Fatalf("past HTTP-date = (%v, %v), want (0, true)", got, ok)
	}
}

func TestCapHint(t *testing.T) {
	tests := []struct {
		name    string
		hint    time.Duration
		ceiling time.Duration
		want    time.Duration
	}{
		{"under ceiling unchanged", 5 * time.Second, sdkCeiling, 5 * time.Second},
		{"over ceiling capped", 120 * time.Second, sdkCeiling, sdkCeiling},
		{"exactly at ceiling unchanged", sdkCeiling, sdkCeiling, sdkCeiling},
		{"NoCeiling never caps", time.Hour, callbackCeiling, time.Hour},
		{"negative ceiling is treated as no cap", time.Hour, -time.Second, time.Hour},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := CapHint(tc.hint, tc.ceiling); got != tc.want {
				t.Fatalf("CapHint(%v, %v) = %v, want %v", tc.hint, tc.ceiling, got, tc.want)
			}
		})
	}
}

// TestDelayWithHintCallerPoliciesDivergeOnSameInput is the acceptance pin for
// #2244 slice 3: one header value, two callers, two different outcomes, and
// neither outcome may come from a hidden default.
func TestDelayWithHintCallerPoliciesDivergeOnSameInput(t *testing.T) {
	const (
		backoff = 1 * time.Second
		header  = "120"
	)

	sdkGot := DelayWithHint(backoff, header, sdkCeiling)
	callbackGot := DelayWithHint(backoff, header, callbackCeiling)

	if sdkGot != sdkCeiling {
		t.Fatalf("SDK adapter delay = %v, want the 30s ceiling", sdkGot)
	}
	if callbackGot != 120*time.Second {
		t.Fatalf("callback client delay = %v, want the uncapped 120s hint", callbackGot)
	}
	if sdkGot == callbackGot {
		t.Fatal("the two caller policies must differ on this input; a shared default has crept back in")
	}
}

func TestDelayWithHintFallsBackToBackoff(t *testing.T) {
	tests := []struct {
		name    string
		backoff time.Duration
		header  string
		ceiling time.Duration
		want    time.Duration
	}{
		{"no header keeps backoff", 2 * time.Second, "", sdkCeiling, 2 * time.Second},
		{"garbage header keeps backoff", 2 * time.Second, "soon", sdkCeiling, 2 * time.Second},
		{"hint below backoff keeps backoff", 4 * time.Second, "1", sdkCeiling, 4 * time.Second},
		{"hint above backoff wins", 1 * time.Second, "5", sdkCeiling, 5 * time.Second},
		{"uncapped hint above backoff wins", 1 * time.Second, "3600", callbackCeiling, time.Hour},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := DelayWithHint(tc.backoff, tc.header, tc.ceiling); got != tc.want {
				t.Fatalf("DelayWithHint(%v, %q, %v) = %v, want %v", tc.backoff, tc.header, tc.ceiling, got, tc.want)
			}
		})
	}
}
