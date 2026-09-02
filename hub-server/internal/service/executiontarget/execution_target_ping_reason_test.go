package executiontarget

import (
	"errors"
	"fmt"
	"net"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/egress"
)

// TestPingFailureReasonPolicyDenialsAreNotReportedUnreachable locks the fix for
// the misattributed egress refusal. egress.ErrUnsupportedScheme's text is
// "egress: unsupported URL scheme (https required, or http with AllowPlainHTTP)"
// — it does NOT contain "not allowed", so message-text matching classified a
// scheme refusal as a network failure and told API consumers
// "ping failed: target unreachable". Operators then went looking at the network
// instead of at the target configuration.
//
// Each case below reproduces the exact error shape egress actually returns:
// bare sentinels (egress.go:137, :140) and %w-wrapped ones (egress.go:182, :199).
func TestPingFailureReasonPolicyDenialsAreNotReportedUnreachable(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantReason string
	}{
		{
			name:       "unsupported_scheme_bare_sentinel",
			err:        egress.ErrUnsupportedScheme,
			wantReason: "target URL scheme not allowed by egress policy",
		},
		{
			name:       "plain_http_denied_bare_sentinel",
			err:        egress.ErrPlainHTTPDenied,
			wantReason: "plain http not allowed by egress policy",
		},
		{
			name:       "restricted_address_wrapped_with_host",
			err:        fmt.Errorf("%w: host %q resolves to restricted address %s", egress.ErrRestrictedAddress, "edge.internal", "10.0.0.5"),
			wantReason: "target not allowed by egress policy",
		},
		{
			name:       "restricted_address_wrapped_with_ip",
			err:        fmt.Errorf("%w: %s", egress.ErrRestrictedAddress, "127.0.0.1"),
			wantReason: "target not allowed by egress policy",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := pingFailureReason(tc.err)

			require.NotEqual(t, "target unreachable", got,
				"policy denial misreported as a network failure for err=%v", tc.err)
			require.Equal(t, tc.wantReason, got)
			// Existing contract: execution_target_test.go:267 requires the
			// surfaced error to name the egress policy denial via "not allowed".
			require.Contains(t, got, "not allowed", "policy denial reason must name the egress policy")
			// #2154 F17: the egress error text embeds the resolved internal
			// address; the API-facing reason must never carry it over.
			require.NotContains(t, got, "10.0.0.5")
			require.NotContains(t, got, "127.0.0.1")
			require.NotContains(t, got, "edge.internal")
		})
	}
}

// TestPingFailureReasonTransientFailuresStayUnreachable is the other half of the
// contract: ordinary dial/DNS/timeout failures must NOT be dressed up as policy
// denials. The second case is the mirror image of the bug — its message text
// contains "not allowed" but it is not one of egress's typed sentinels, so
// matching on text would blame the egress policy for a firewall/network fault.
func TestPingFailureReasonTransientFailuresStayUnreachable(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{
			name: "connection_refused",
			err:  &net.OpError{Op: "dial", Net: "tcp", Addr: &net.TCPAddr{}, Err: errors.New("connect: connection refused")},
		},
		{
			name: "dns_failure_wrapped_by_egress",
			err:  fmt.Errorf("egress: resolve %q: %w", "edge.example.com", errors.New("no such host")),
		},
		{
			name: "timeout",
			err:  errors.New("context deadline exceeded"),
		},
		{
			name: "unrelated_error_whose_text_happens_to_say_not_allowed",
			err:  errors.New("dial tcp 203.0.113.9:3210: middlebox replied not allowed"),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := pingFailureReason(tc.err)
			require.Equal(t, "target unreachable", got)
			require.NotContains(t, got, "egress policy",
				"transient failure blamed on the egress policy for err=%v", tc.err)
		})
	}
}

// TestPingFailureReasonClassifiesBySentinelNotByText proves the classification
// depends on errors.Is and not on wording: the same sentinel wrapped deeper
// (as a transport would) is still recognised, and a sentinel-free error carrying
// the policy wording is still treated as a network failure.
func TestPingFailureReasonClassifiesBySentinelNotByText(t *testing.T) {
	deep := fmt.Errorf("Get %q: %w", "https://edge.internal:3210/v1/health",
		fmt.Errorf("%w: %s", egress.ErrRestrictedAddress, "169.254.169.254"))
	require.True(t, errors.Is(deep, egress.ErrRestrictedAddress), "precondition: the wrapped sentinel must be detectable")
	require.Equal(t, "target not allowed by egress policy", pingFailureReason(deep))
	require.NotContains(t, pingFailureReason(deep), "169.254.169.254", "#2154 F17: resolved address must not reach API consumers")
}
