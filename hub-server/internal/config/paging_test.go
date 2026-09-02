package config

import "testing"

// TestClampPageSize pins the three branches, and in particular that an
// over-maximum request clamps to the maximum instead of collapsing to the
// default — the collapse was the #2154 bug this helper exists to end.
func TestClampPageSize(t *testing.T) {
	const (
		max = 200
		def = 50
	)
	cases := []struct {
		name      string
		requested int
		want      int
	}{
		{"zero falls back to the default", 0, def},
		{"negative falls back to the default", -7, def},
		{"one is honoured", 1, 1},
		{"in-range is honoured exactly", 137, 137},
		{"the maximum itself is honoured", max, max},
		{"one over the maximum clamps to the maximum", max + 1, max},
		{"the handler-layer ceiling clamps to the maximum", MaxPageLimit, max},
		{"an absurd value clamps to the maximum", 1 << 20, max},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if got := ClampPageSize(tc.requested, max, def); got != tc.want {
				t.Fatalf("ClampPageSize(%d, %d, %d) = %d, want %d", tc.requested, max, def, got, tc.want)
			}
		})
	}
}

// TestClampPageSize_RespectsCallerMaximum checks the helper is not hardwired to
// one maximum: the message family clamps at MaxMessagePageLimit and the
// document family at MaxPageLimit.
func TestClampPageSize_RespectsCallerMaximum(t *testing.T) {
	if got := ClampPageSize(MaxMessagePageLimit+1, MaxMessagePageLimit, DefaultPaginationLimit); got != MaxMessagePageLimit {
		t.Fatalf("message-family clamp = %d, want %d", got, MaxMessagePageLimit)
	}
	if got := ClampPageSize(MaxPageLimit+1, MaxPageLimit, DefaultPaginationLimit); got != MaxPageLimit {
		t.Fatalf("document-family clamp = %d, want %d", got, MaxPageLimit)
	}
	if MaxListPageSize != 200 {
		t.Fatalf("MaxListPageSize = %d, want 200: it is the value api/openapi.yaml declares for the shared PageSize parameter, so changing it is a contract change", MaxListPageSize)
	}
}
