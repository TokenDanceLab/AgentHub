package middleware

import (
	"errors"
	"fmt"
	"net"
	"os"
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// textFreeEPIPE is an error that IS syscall.EPIPE for errors.Is purposes but
// renders without any of the phrases the old text matcher looked for. It makes
// the structural tier observable: an implementation that only reads strings
// answers false here, an implementation that asks the errno answers true.
type textFreeEPIPE struct{}

func (textFreeEPIPE) Error() string { return "peer vanished mid-response" }

func (textFreeEPIPE) Is(target error) bool { return target == syscall.EPIPE }

// notAnError is a recover() payload that is not an error at all but whose
// String() mentions both phrases. isBrokenPipe takes `any`, so this must be
// rejected without panicking rather than being string-matched.
type notAnError struct{}

func (notAnError) String() string { return "broken pipe / connection reset by peer" }

func opErr(inner error) *net.OpError {
	return &net.OpError{Op: "write", Net: "tcp", Source: &net.TCPAddr{IP: net.IPv4(10, 0, 0, 1), Port: 8080}, Addr: &net.TCPAddr{IP: net.IPv4(10, 0, 0, 2), Port: 51000}, Err: inner}
}

// TestIsBrokenPipe_Structural covers the errno-driven recognition that replaced
// the string matching in isBrokenPipe (#2244 slice 2). Every case in the first
// group is decided by errors.Is unwrapping down to a syscall.Errno, not by the
// English rendering of it — which is why the wrapped, bare, and text-free
// shapes below were all false before the change.
func TestIsBrokenPipe_Structural(t *testing.T) {
	cases := []struct {
		name string
		err  any
	}{
		{
			name: "net.OpError -> os.SyscallError -> EPIPE",
			err:  opErr(&os.SyscallError{Syscall: "write", Err: syscall.EPIPE}),
		},
		{
			name: "net.OpError -> os.SyscallError -> ECONNRESET",
			err:  opErr(&os.SyscallError{Syscall: "read", Err: syscall.ECONNRESET}),
		},
		{
			name: "net.OpError -> bare EPIPE errno (no os.SyscallError wrapper)",
			err:  opErr(syscall.EPIPE),
		},
		{
			name: "net.OpError -> bare ECONNRESET errno (no os.SyscallError wrapper)",
			err:  opErr(syscall.ECONNRESET),
		},
		{
			// The previous implementation type-asserted err.(*net.OpError) at
			// the top level, so a caller-wrapped OpError was never recognised.
			name: "net.OpError wrapped with %w by the caller",
			err:  fmt.Errorf("flush response to client: %w", opErr(&os.SyscallError{Syscall: "write", Err: syscall.EPIPE})),
		},
		{
			name: "bare EPIPE errno outside any net.OpError",
			err:  syscall.EPIPE,
		},
		{
			name: "bare os.SyscallError(ECONNRESET) outside any net.OpError",
			err:  &os.SyscallError{Syscall: "write", Err: syscall.ECONNRESET},
		},
		{
			// Decided purely by errno identity: the rendered text contains
			// neither "broken pipe" nor "connection reset by peer".
			name: "net.OpError whose Err is EPIPE by identity but text-free",
			err:  opErr(textFreeEPIPE{}),
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			assert.True(t, isBrokenPipe(tc.err),
				"a client-disconnect errno must be recognised structurally, whatever wraps it")
		})
	}
}

// TestIsBrokenPipe_LegacyTextShapeIsStillRecognised is the no-regression proof
// for the branch the old implementation covered by text: a *net.OpError whose
// Err is neither a syscall.Errno nor an *os.SyscallError carries no structured
// signal at all, only a message. isBrokenPipe keeps a text tier scoped to
// exactly that shape so these two forms stay recognised.
func TestIsBrokenPipe_LegacyTextShapeIsStillRecognised(t *testing.T) {
	cases := []struct {
		name string
		err  any
	}{
		{
			name: "net.OpError wrapping a text-only 'broken pipe' error",
			err:  opErr(errors.New("broken pipe")),
		},
		{
			name: "net.OpError wrapping a text-only 'connection reset by peer' error",
			err:  opErr(errors.New("read tcp 10.0.0.1:8080->10.0.0.2:51000: connection reset by peer")),
		},
		{
			name: "net.OpError wrapping a text-only error, itself wrapped with %w",
			err:  fmt.Errorf("write: %w", opErr(errors.New("broken pipe"))),
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			assert.True(t, isBrokenPipe(tc.err), "the pre-existing text-covered shape must not regress")
		})
	}
}

// TestIsBrokenPipe_NonErrorRecoverValuesAreSafe covers the second semantic that
// must survive the rewrite: the parameter is `any` because it is the raw return
// value of recover(), which may be any type at all. None of these is an error,
// so none may be classified as a broken pipe — and none may panic.
func TestIsBrokenPipe_NonErrorRecoverValuesAreSafe(t *testing.T) {
	cases := []struct {
		name string
		err  any
	}{
		{name: "nil", err: nil},
		{name: "plain string", err: "something broke"},
		{name: "string mentioning both phrases", err: "broken pipe / connection reset by peer"},
		{name: "int", err: 42},
		{name: "empty struct", err: struct{}{}},
		{name: "struct whose String() mentions both phrases", err: notAnError{}},
		{name: "slice", err: []byte("broken pipe")},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			require.NotPanics(t, func() {
				assert.False(t, isBrokenPipe(tc.err),
					"a non-error recover() payload is by definition not a broken pipe")
			})
		})
	}
}

// TestIsBrokenPipe_UnrelatedErrorsAreNotSwallowed guards the other direction:
// suppressing the panic log and the http_panic_recoveries_total increment is
// only correct for a client disconnect, so any other failure must stay visible.
func TestIsBrokenPipe_UnrelatedErrorsAreNotSwallowed(t *testing.T) {
	cases := []struct {
		name string
		err  any
	}{
		{name: "ENOENT inside net.OpError", err: opErr(&os.SyscallError{Syscall: "open", Err: syscall.ENOENT})},
		{name: "ECONNABORTED inside net.OpError", err: opErr(&os.SyscallError{Syscall: "accept", Err: syscall.ECONNABORTED})},
		{name: "i/o timeout inside net.OpError", err: opErr(errors.New("i/o timeout"))},
		{name: "plain application error", err: errors.New("nil pointer dereference in handler")},
		{name: "wrapped plain application error", err: fmt.Errorf("handler: %w", errors.New("index out of range"))},
		{name: "bare ECONNABORTED errno", err: syscall.ECONNABORTED},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			assert.False(t, isBrokenPipe(tc.err), "only client disconnects may be suppressed")
		})
	}
}
