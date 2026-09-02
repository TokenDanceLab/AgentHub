package outboundhttp

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewClientDefaultTimeoutOnNonPositiveInput(t *testing.T) {
	for _, input := range []time.Duration{0, -1 * time.Second} {
		client := NewClient(input)
		if client.Timeout != DefaultTimeout {
			t.Errorf("NewClient(%v).Timeout = %v, want %v", input, client.Timeout, DefaultTimeout)
		}
	}
}

func TestNewClientKeepsExplicitTimeout(t *testing.T) {
	client := NewClient(3 * time.Second)
	if client.Timeout != 3*time.Second {
		t.Errorf("NewClient(3s).Timeout = %v, want 3s", client.Timeout)
	}
}

func TestNewClientRefusesRedirects(t *testing.T) {
	client := NewClient(time.Second)
	if client.CheckRedirect == nil {
		t.Fatal("NewClient must install a CheckRedirect policy")
	}
	// ErrUseLastResponse is the policy contract: headers/payload must never be
	// replayed to another origin (token exchange / JWKS fetches).
	err := client.CheckRedirect(&http.Request{}, []*http.Request{{}})
	if !errors.Is(err, http.ErrUseLastResponse) {
		t.Errorf("CheckRedirect returned %v, want http.ErrUseLastResponse", err)
	}
}

func TestReadLimitedBoundaries(t *testing.T) {
	tests := []struct {
		name      string
		body      string
		max       int64
		wantBody  string
		wantError bool
	}{
		{name: "exactly at cap", body: "1234", max: 4, wantBody: "1234"},
		{name: "one byte over cap", body: "12345", max: 4, wantError: true},
		{name: "well under cap", body: "hi", max: 1024, wantBody: "hi"},
		{name: "non-positive max falls back to 64KiB", body: strings.Repeat("a", 64*1024), max: 0, wantBody: strings.Repeat("a", 64*1024)},
		{name: "non-positive max with oversized body", body: strings.Repeat("a", 64*1024+1), max: -1, wantError: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body, err := ReadLimited(strings.NewReader(tc.body), tc.max)
			if tc.wantError {
				if err == nil {
					t.Fatal("ReadLimited returned nil error, want ErrBodyTooLarge")
				}
				if !errors.Is(err, ErrBodyTooLarge) {
					t.Fatalf("ReadLimited error = %v, want ErrBodyTooLarge", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ReadLimited returned unexpected error: %v", err)
			}
			if string(body) != tc.wantBody {
				t.Errorf("ReadLimited body = %q, want %q", body, tc.wantBody)
			}
		})
	}
}

func TestReadLimitedPropagatesReaderError(t *testing.T) {
	sentinel := errors.New("source broke")
	_, err := ReadLimited(io.MultiReader(strings.NewReader("partial"), errorReader{err: sentinel}), 1024)
	if !errors.Is(err, sentinel) {
		t.Errorf("ReadLimited error = %v, want sentinel reader error", err)
	}
}

// errorReader fails every Read call with a fixed error.
type errorReader struct{ err error }

func (r errorReader) Read([]byte) (int, error) { return 0, r.err }

// TestNewClientTimeoutEnforced 证明 Timeout 是整个请求的截止时间：
// 永不响应的服务器得到 net.Error 超时，而不是无限挂起（审计维度 1）。
func TestNewClientTimeoutEnforced(t *testing.T) {
	client := NewClient(200 * time.Millisecond)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(srv.Close)

	_, err := client.Get(srv.URL)
	if err == nil {
		t.Fatal("Get to a never-responding server succeeded, want timeout error")
	}
	var ne net.Error
	if !errors.As(err, &ne) || !ne.Timeout() {
		t.Fatalf("error = %v, want net.Error with Timeout()=true", err)
	}
}

// TestNewClientRespectsRequestContext 证明客户端尊重调用方绑定的 ctx：
// outboundhttp 不注入自己的 ctx，NewRequestWithContext 是调用方职责
// （oidc token 交换与 dispatchsvc Edge 派发均如此绑定）。
func TestNewClientRespectsRequestContext(t *testing.T) {
	client := NewClient(10 * time.Second)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(srv.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL, nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext: %v", err)
	}
	_, err = client.Do(req)
	if err == nil {
		t.Fatal("Do succeeded after ctx deadline, want deadline error")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error = %v, want context.DeadlineExceeded", err)
	}
}

// TestRedirectRefusalBehavior 在 HTTP 行为层证明重定向拒绝：
// 302 原样返回，Location 目标不收到任何请求。
func TestRedirectRefusalBehavior(t *testing.T) {
	var replayHits int64
	mux := http.NewServeMux()
	mux.HandleFunc("/replay", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&replayHits, 1)
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/origin", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/replay", http.StatusFound)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	client := NewClient(time.Second)
	resp, err := client.Get(srv.URL + "/origin")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want 302 surfaced untransformed", resp.StatusCode)
	}
	if got := atomic.LoadInt64(&replayHits); got != 0 {
		t.Fatalf("redirect target hits = %d, want 0 (redirect must not be followed)", got)
	}
}

// TestPostBodyNeverReplayedOnRedirect 是 token 交换的凭据重放防御核心：
// 携带 secret 的 POST 遇到 302 时，body 绝不能重放到重定向目标。
func TestPostBodyNeverReplayedOnRedirect(t *testing.T) {
	var replayHits int64
	mux := http.NewServeMux()
	mux.HandleFunc("/elsewhere", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&replayHits, 1)
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/elsewhere", http.StatusFound)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	client := NewClient(time.Second)
	resp, err := client.Post(srv.URL+"/token", "application/x-www-form-urlencoded", strings.NewReader("client_secret=s3cr3t"))
	if err != nil {
		t.Fatalf("Post: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want 302 (redirect must not be followed)", resp.StatusCode)
	}
	if got := atomic.LoadInt64(&replayHits); got != 0 {
		t.Fatalf("redirect target hits = %d, want 0 (POST body must never be replayed)", got)
	}
}

// TestNoRetryOnServerError 证明无应用层重试语义：
// 5xx 原样返回（err=nil + 响应），服务端恰好收到 1 次请求。
func TestNoRetryOnServerError(t *testing.T) {
	var hits int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	client := NewClient(time.Second)
	resp, err := client.Get(srv.URL)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 surfaced untransformed", resp.StatusCode)
	}
	if got := atomic.LoadInt64(&hits); got != 1 {
		t.Fatalf("server hits = %d, want exactly 1 (no retry)", got)
	}
}

// TestNewClientCarriesOwnTransportWithWideIdlePool pins the connection-churn
// fix (#2154): clients must not share the process-global DefaultTransport
// (MaxIdleConnsPerHost=2) — each gets its own cloned transport with a wider
// per-host idle pool.
func TestNewClientCarriesOwnTransportWithWideIdlePool(t *testing.T) {
	client := NewClient(time.Second)
	tr, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("Transport = %T, want *http.Transport", client.Transport)
	}
	if tr.MaxIdleConnsPerHost != DefaultMaxIdleConnsPerHost {
		t.Errorf("MaxIdleConnsPerHost = %d, want %d", tr.MaxIdleConnsPerHost, DefaultMaxIdleConnsPerHost)
	}
	if tr == http.DefaultTransport.(*http.Transport) {
		t.Error("NewClient must not reuse the process-global DefaultTransport")
	}
	other, _ := NewClient(time.Second).Transport.(*http.Transport)
	if other == tr {
		t.Error("each NewClient must clone a fresh transport (isolated pools)")
	}
}
