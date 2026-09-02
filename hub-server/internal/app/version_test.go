package app

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
)

// TestNewAppReportsNonEmptyBuildVersion pins that an App always knows which
// build it is. The Version field used to have no assignment anywhere in the
// repo (and, being a struct field, was unreachable by `-ldflags -X`, which can
// only write package-level string variables), so every /health answer reported
// the handler's literal "dev" fallback regardless of the build that produced
// it and an incident could not be traced back to a commit.
func TestNewAppReportsNonEmptyBuildVersion(t *testing.T) {
	a := New(&config.Config{}, nil, nil)

	require.NotEmpty(t, a.Version,
		"App.Version must be resolved at construction; an empty version silently "+
			"disappears from JSON payloads and is harder to triage than an explicit fallback")
	t.Logf("resolved version = %q", a.Version)
}

// TestDarkCheckInjectedVersionIsServedOnRealSocket is the unforgeable
// end-to-end acceptance for the link-time symbol. It never runs App.Run
// (initInfra needs DB+Redis and startServer would wake the task scheduler / WS
// cleanup / delivery retry writers on a shared dev box); instead it mounts the
// real HealthHandler on a real gin engine bound to a kernel-assigned free port
// (never :8080) and speaks real HTTP to it.
//
// Run it with the injection to prove the -X symbol reaches the wire:
//
//	go test -ldflags="-X github.com/agenthub/hub-server/internal/app.Version=vDARKCHECK.1" \
//	  ./internal/app/ -run DarkCheck -v
func TestDarkCheckInjectedVersionIsServedOnRealSocket(t *testing.T) {
	a := New(&config.Config{}, nil, nil)
	require.NotEmpty(t, a.Version,
		"the version served on the socket is only traceable if App.Version is resolved")

	baseURL := serveHealthOnFreePort(t, a.Version)

	for _, path := range []string{"/health", "/health/live"} {
		served := fetchServedVersion(t, baseURL, path)

		require.NotEmpty(t, served, "%s must never report an empty version", path)
		require.Equal(t, a.Version, served,
			"%s must serve App.Version verbatim; if it does not, the handler's "+
				"literal fallback is masking an empty build identity", path)
		require.Equal(t, resolveVersion(Version), served,
			"%s must serve what resolveVersion derives from the link-time symbol", path)

		if Version != "" {
			// Only reachable when the binary was linked with
			// -X github.com/agenthub/hub-server/internal/app.Version=<value>:
			// that exact value must survive resolution and reach the wire.
			require.Equal(t, Version, served,
				"the -X injected symbol must be served verbatim on %s", path)
			t.Logf("DARKCHECK link-time symbol %q reached %s (real socket %s)", Version, path, baseURL)
		} else {
			t.Logf("DARKCHECK not injected: %s served the honest fallback %q", path, served)
		}
	}
}

// TestNewAppResolvesFromTheLinkTimeVersionSymbol pins the wiring between the
// symbol `-ldflags -X` can actually write (a package-level string variable) and
// the field operators read, without mutating package state: Version stays
// write-once, so parallel tests cannot pollute each other.
func TestNewAppResolvesFromTheLinkTimeVersionSymbol(t *testing.T) {
	a := New(&config.Config{}, nil, nil)

	require.NotEmpty(t, a.Version)
	require.Equal(t, resolveVersion(Version), a.Version,
		"New must resolve App.Version from the package-level Version symbol")
}

// TestResolveVersionPrefersExplicitValue pins the top of the priority chain: a
// value stamped in at link time (or supplied by a caller) wins over VCS
// stamping and over the literal fallback, so tag builds report the tag.
func TestResolveVersionPrefersExplicitValue(t *testing.T) {
	for _, explicit := range []string{"vTEST.1", "vDARKCHECK.1", "v0.6.1", "0.6.1-rc.2"} {
		require.Equal(t, explicit, resolveVersion(explicit),
			"an explicit version must be reported verbatim")
	}

	// A padded value is still an explicit value; surrounding whitespace must not
	// push resolution down to the stamping/fallback branches.
	require.Equal(t, "vTEST.1", resolveVersion("  vTEST.1  "))
}

// TestResolveVersionRejectsBlankExplicitValue proves the explicit branch does
// not swallow a value that carries no information: whitespace-only input must
// fall through to stamping/fallback rather than become the reported version.
func TestResolveVersionRejectsBlankExplicitValue(t *testing.T) {
	for _, blank := range []string{"", " ", "\t", "\n", "   \t\n "} {
		require.Equal(t, resolveVersion(""), resolveVersion(blank),
			"blank explicit value %q must resolve exactly like no explicit value", blank)
	}
}

// TestResolveVersionPrefersBuildStampingOverLiteralFallback pins the middle of
// the chain: the VCS stamping the go command embeds in module builds wins over
// the literal "dev", and "dev" is only reached when the binary carries no
// stamping at all (so "dev" never masquerades as a sha).
func TestResolveVersionPrefersBuildStampingOverLiteralFallback(t *testing.T) {
	got := resolveVersion("")
	stamped := buildInfoVersion()

	require.NotEmpty(t, got, "resolveVersion must never return an empty version")
	require.Equal(t, strings.TrimSpace(got), got, "resolved version must not carry whitespace")

	if stamped != "" {
		require.Equal(t, stamped, got,
			"VCS stamping embedded by the go command must win over the literal fallback")
	} else {
		require.Equal(t, versionFallback, got,
			"with no VCS stamping the literal fallback must be reported, never \"\"")
	}
	t.Logf("resolveVersion(\"\") = %q (buildInfoVersion = %q)", got, stamped)
}

// TestResolveVersionNeverReturnsEmptyString is the standalone guard for the
// root cause of this slice: an empty version does not merely look wrong, it
// disappears from the JSON payload, so an operator reading /health cannot even
// tell that the field was meant to carry a build identity. No input may
// produce it.
func TestResolveVersionNeverReturnsEmptyString(t *testing.T) {
	inputs := []string{
		"", " ", "\t\n", "vTEST.1", "0.6.1", "e77808bf960e", "v0.6.1-dirty",
		strings.Repeat("x", 200), "\x00-injected",
	}

	for _, in := range inputs {
		got := resolveVersion(in)
		require.NotEmpty(t, got, "resolveVersion(%q) must never be empty", in)
		require.Equal(t, strings.TrimSpace(got), got, "resolveVersion(%q) must not carry whitespace", in)

		if strings.TrimSpace(in) != "" {
			// An informative value must be reported verbatim: it may never be
			// replaced by the literal fallback.
			require.Equal(t, strings.TrimSpace(in), got,
				"resolveVersion(%q) must keep the explicit value", in)
		}
		// A blank value legitimately lands on stamping or the literal fallback;
		// both are non-empty, which is the only invariant that matters here.
	}

	// The two fallback tracks must also be non-empty by construction.
	require.NotEmpty(t, resolveVersion(""))
	require.NotEmpty(t, versionFallback)
}

// serveHealthOnFreePort mounts the real HealthHandler (nil dependencies: the
// report degrades, but the version is reported unchanged) on a real HTTP server
// bound to 127.0.0.1:0, i.e. a port the kernel picks for us. No fixed port is
// ever taken, so this cannot collide with the live dev hub on :8080.
func serveHealthOnFreePort(t *testing.T, version string) string {
	t.Helper()

	gin.SetMode(gin.TestMode)

	h := handler.NewHealthHandler(nil, nil, nil, time.Now(), version)
	r := gin.New()
	r.GET("/health", h.Check)
	r.GET("/health/live", h.Live)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err, "kernel-assigned loopback port must be available")

	srv := httptest.NewUnstartedServer(r)
	srv.Listener = ln
	srv.Start()
	t.Cleanup(srv.Close)

	return srv.URL
}

// fetchServedVersion performs a real HTTP GET and returns the "version" field
// of the health envelope's data object.
func fetchServedVersion(t *testing.T, baseURL, path string) string {
	t.Helper()

	resp, err := http.Get(baseURL + path) //nolint:gosec,noctx // loopback test server with a kernel-assigned port
	require.NoError(t, err)
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()

	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	var body struct {
		Data map[string]any `json:"data"`
	}
	require.NoError(t, json.Unmarshal(raw, &body), "health envelope must decode: %s", raw)
	require.NotNil(t, body.Data, "health envelope must carry data: %s", raw)

	version, ok := body.Data["version"].(string)
	require.True(t, ok, "version must be a JSON string: %s", raw)
	return version
}
