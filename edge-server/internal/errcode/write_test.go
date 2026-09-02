package errcode

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestErrCodeWriteUsesErrorHTTPStatus is the structural guard against Write
// becoming the next hand-copied status point. 418 is deliberately a status that
// no sentinel in this package uses, so a hard-coded status (or a status looked
// up from a code->status table) cannot pass. Note the call site below passes no
// status argument at all: the signature itself is part of the guarantee, and
// adding a status parameter back would fail to compile here.
func TestErrCodeWriteUsesErrorHTTPStatus(t *testing.T) {
	e := New("teapot_code", "i am a teapot", http.StatusTeapot)
	rec := httptest.NewRecorder()

	Write(rec, e)

	if rec.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want %d (must come from e.HTTPStatus, not from the call site)", rec.Code, http.StatusTeapot)
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			TraceID string `json:"traceId"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q is not the standard envelope: %v", rec.Body.String(), err)
	}
	if body.Error.Code != "teapot_code" || body.Error.Message != "i am a teapot" {
		t.Fatalf("envelope = %+v, want code/message from e", body.Error)
	}
	if body.Error.TraceID == "" {
		t.Fatal("traceId must be populated, matching ErrorBody")
	}
}

// TestErrCodeWriteSentinelStatusTable pins status==e.HTTPStatus across the real
// sentinels, including the two the delivery-journal handlers now use.
func TestErrCodeWriteSentinelStatusTable(t *testing.T) {
	cases := []struct {
		name string
		e    *Error
	}{
		{"not_configured_is_503", ErrNotConfigured},
		{"internal_is_500", ErrInternal},
		{"bad_request_is_400", ErrBadRequest},
		{"not_found_is_404", ErrNotFound},
		{"method_not_allowed_is_405", ErrMethodNotAllowed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			Write(rec, tc.e)
			if rec.Code != tc.e.HTTPStatus {
				t.Fatalf("status = %d, want e.HTTPStatus = %d", rec.Code, tc.e.HTTPStatus)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
				t.Fatalf("Content-Type = %q, want the resputil JSON content type", ct)
			}
			var body map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("body %q is not JSON: %v", rec.Body.String(), err)
			}
			errObj, ok := body["error"].(map[string]any)
			if !ok {
				t.Fatalf("body %q has no error object", rec.Body.String())
			}
			if errObj["code"] != tc.e.Code {
				t.Fatalf("code = %#v, want %q", errObj["code"], tc.e.Code)
			}
		})
	}
}

// TestErrCodeWriteMatchesErrorBodyEnvelope proves Write is ErrorBody plus the
// status from e.HTTPStatus and nothing else: the wire body must be identical to
// what the ~160 existing writeJSON(w, status, ErrorBody(e)) call sites produce.
func TestErrCodeWriteMatchesErrorBodyEnvelope(t *testing.T) {
	e := ErrNotConfigured.WithMessage("delivery journal not configured")

	viaWrite := httptest.NewRecorder()
	Write(viaWrite, e)

	if viaWrite.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", viaWrite.Code)
	}
	var got, want map[string]any
	if err := json.Unmarshal(viaWrite.Body.Bytes(), &got); err != nil {
		t.Fatalf("Write body %q is not JSON: %v", viaWrite.Body.String(), err)
	}
	// ErrorBody stamps a fresh traceId per call, so compare the stable fields.
	gotErr := got["error"].(map[string]any)
	if gotErr["message"] != "delivery journal not configured" {
		t.Fatalf("message = %#v, want the WithMessage text preserved", gotErr["message"])
	}
	want = ErrorBody(e)
	wantErr := want["error"].(map[string]any)
	if gotErr["code"] != wantErr["code"] || gotErr["message"] != wantErr["message"] {
		t.Fatalf("Write envelope = %+v, want ErrorBody envelope = %+v", gotErr, wantErr)
	}
}
