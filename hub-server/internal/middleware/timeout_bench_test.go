package middleware_test

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/model"
)

// BenchmarkTimeoutJSONResponses isolates middleware plus real Hub JSON encoding
// from database/network costs. Row counts include the repository's actual cap;
// prompt sizes are declared fixtures, NOT a universal response-byte ceiling.
// TimeoutStream is only a cost control: it cannot replace buffered Timeout's
// all-or-nothing response/deadline semantics just because it allocates less.
// Run with -run '^$' -bench '^BenchmarkTimeoutJSONResponses$' -benchmem -cpu=1,4.
func BenchmarkTimeoutJSONResponses(b *testing.B) {
	gin.SetMode(gin.TestMode)
	for _, size := range []struct{ rows, promptBytes int }{
		{50, 256},
		{config.MaxPageLimit, 256},
		{config.MaxPageLimit, 4096},
	} {
		b.Run(fmt.Sprintf("rows=%d/prompt=%d", size.rows, size.promptBytes), func(b *testing.B) {
			payload := timeoutBenchmarkAgents(size.rows, size.promptBytes)
			for i := range payload {
				if err := payload[i].Validate(); err != nil {
					b.Fatal(err)
				}
			}
			request := httptest.NewRequest(http.MethodGet, "/web/custom-agents", nil)
			baseline := httptest.NewRecorder()
			timeoutBenchmarkRouter(payload, nil).ServeHTTP(baseline, request)
			if baseline.Code != http.StatusOK {
				b.Fatalf("baseline status = %d", baseline.Code)
			}
			for _, mode := range []struct {
				name string
				wrap gin.HandlerFunc
			}{
				{"none", nil},
				{"buffered", middleware.Timeout(30 * time.Second)},
				{"stream", middleware.TimeoutStream(30 * time.Second)},
			} {
				b.Run(mode.name, func(b *testing.B) {
					router := timeoutBenchmarkRouter(payload, mode.wrap)
					probe := httptest.NewRecorder()
					router.ServeHTTP(probe, request)
					if probe.Code != baseline.Code || !reflect.DeepEqual(probe.Header(), baseline.Header()) || !bytes.Equal(probe.Body.Bytes(), baseline.Body.Bytes()) {
						b.Fatal("control middleware changed the serialized response")
					}
					payloadBytes := baseline.Body.Len()
					sink := &timeoutBenchmarkWriter{header: make(http.Header)}
					b.SetBytes(int64(payloadBytes))
					b.ReportAllocs()
					for b.Loop() {
						clear(sink.header)
						sink.status, sink.bytes = 0, 0
						router.ServeHTTP(sink, request)
						if sink.status != http.StatusOK || sink.bytes != payloadBytes {
							b.Fatalf("status=%d bytes=%d, want 200 / %d", sink.status, sink.bytes, payloadBytes)
						}
					}
					b.ReportMetric(float64(payloadBytes), "payload-B/op")
				})
			}
		})
	}
}

func timeoutBenchmarkRouter(payload []model.CustomAgent, wrap gin.HandlerFunc) *gin.Engine {
	r := gin.New()
	if wrap != nil {
		r.Use(wrap)
	}
	// This is the same success envelope and model serialization as List.
	r.GET("/web/custom-agents", func(c *gin.Context) { handler.OK(c, payload) })
	return r
}

func timeoutBenchmarkAgents(count, promptBytes int) []model.CustomAgent {
	const phrase = "Summarize changes and cite verified evidence. "
	prompt := strings.Repeat(phrase, promptBytes/len(phrase)+1)[:promptBytes]
	rows := make([]model.CustomAgent, count)
	for i := range rows {
		rows[i] = model.CustomAgent{
			ID:          fmt.Sprintf("00000000-0000-4000-8000-%012d", i+1),
			OwnerUserID: "00000000-0000-4000-8000-000000000000", Name: "Review helper",
			AgentType: "codex", SystemPrompt: prompt,
			CapabilityTags: "[\"review\"]", ToolWhitelist: "[\"read\"]", ModelParams: "{}",
			CreatedAt: time.Unix(0, 0).UTC(), UpdatedAt: time.Unix(0, 0).UTC(),
		}
	}
	return rows
}

// Unlike ResponseRecorder, this timed sink does not retain another payload-sized
// buffer. Contract probes above use a recorder outside the timed loop.
type timeoutBenchmarkWriter struct {
	header http.Header
	status int
	bytes  int
}

func (w *timeoutBenchmarkWriter) Header() http.Header    { return w.header }
func (w *timeoutBenchmarkWriter) WriteHeader(status int) { w.status = status }
func (w *timeoutBenchmarkWriter) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	w.bytes += len(p)
	return len(p), nil
}
