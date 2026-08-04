package outboundmetrics

import (
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func newTestRecorder(t *testing.T) (*Recorder, *prometheus.Registry) {
	t.Helper()
	reg := prometheus.NewRegistry()
	return NewRecorder(reg), reg
}

// TestRecorderNilSafe pins that an unconfigured (nil) recorder is a no-op —
// call sites may record unconditionally without server metrics wiring.
func TestRecorderNilSafe(t *testing.T) {
	var r *Recorder
	r.Record(ProviderEdge, PurposeDispatch, CategoryFailure, "unreachable")
	r.Observe(ProviderEdge, PurposeDispatch, CategorySuccess, StatusOK, 12*time.Millisecond)
	// No panic is the assertion; nothing to scrape.
}

// TestRecorderRegistersContractNames pins the #1595 metric names and label
// dimensions on the recorder's registry.
func TestRecorderRegistersContractNames(t *testing.T) {
	r, reg := newTestRecorder(t)
	r.Record(ProviderEdge, PurposeDispatch, CategorySuccess, StatusOK)
	r.Observe(ProviderEdge, PurposeDispatch, CategorySuccess, StatusOK, 5*time.Millisecond)

	got := testutil.ToFloat64(r.requests.WithLabelValues(ProviderEdge, PurposeDispatch, CategorySuccess, StatusOK))
	if got != 1 {
		t.Fatalf("outbound_requests_total{edge,dispatch,success,ok} = %v, want 1", got)
	}

	families, err := reg.Gather()
	if err != nil {
		t.Fatalf("gather: %v", err)
	}
	var names []string
	for _, f := range families {
		names = append(names, f.GetName())
	}
	if len(names) != 2 {
		t.Fatalf("expected exactly the two contract metrics, got %v", names)
	}
	for _, want := range []string{MetricRequestsTotal, MetricDurationSeconds} {
		found := false
		for _, n := range names {
			if n == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("contract metric %q not registered; got %v", want, names)
		}
	}
}

// TestRecorderObserveRecordsDuration pins that Observe feeds the duration
// histogram with the same label dimensions as Record.
func TestRecorderObserveRecordsDuration(t *testing.T) {
	r, reg := newTestRecorder(t)
	r.Observe(ProviderTokenDanceID, PurposeJWKSFetch, CategoryFailure, StatusNetworkError, 250*time.Millisecond)

	families, err := reg.Gather()
	if err != nil {
		t.Fatalf("gather: %v", err)
	}
	for _, f := range families {
		if f.GetName() != MetricDurationSeconds {
			continue
		}
		if len(f.GetMetric()) != 1 {
			t.Fatalf("expected 1 duration metric, got %d", len(f.GetMetric()))
		}
		labels := make(map[string]string, len(f.GetMetric()[0].GetLabel()))
		for _, lp := range f.GetMetric()[0].GetLabel() {
			labels[lp.GetName()] = lp.GetValue()
		}
		want := map[string]string{
			LabelProvider: ProviderTokenDanceID,
			LabelPurpose:  PurposeJWKSFetch,
			LabelCategory: CategoryFailure,
			LabelStatus:   StatusNetworkError,
		}
		for k, v := range want {
			if labels[k] != v {
				t.Fatalf("duration histogram label %s = %q, want %q (labels: %v)", k, labels[k], v, labels)
			}
		}
		if f.GetMetric()[0].GetHistogram().GetSampleCount() != 1 {
			t.Fatalf("expected 1 duration sample, got %d", f.GetMetric()[0].GetHistogram().GetSampleCount())
		}
	}
}
