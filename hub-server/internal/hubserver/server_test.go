package hubserver_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/agenthub/hub-server/internal/hubserver"
)

func TestHealthReportsHubServiceIdentity(t *testing.T) {
	server := hubserver.New(hubserver.Config{Addr: ":0", Version: "test"})

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body struct {
		Status  string `json:"status"`
		Service string `json:"service"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if body.Status != "ok" || body.Service != "hub-server" || body.Version != "test" {
		t.Fatalf("health body = %+v", body)
	}
}

func TestRegisterEdgeValidatesNameAndReturnsResource(t *testing.T) {
	server := hubserver.New(hubserver.Config{Addr: ":0", Version: "test"})

	req := httptest.NewRequest(http.MethodPost, "/v1/edges:register", strings.NewReader(`{"name":"local-edge","endpoint":"http://127.0.0.1:8081"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var body struct {
		ID       string `json:"id"`
		Kind     string `json:"kind"`
		Name     string `json:"name"`
		Status   string `json:"status"`
		Endpoint string `json:"endpoint"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if body.ID == "" {
		t.Fatal("id is empty")
	}
	if body.Kind != "edge" || body.Name != "local-edge" || body.Status != "registered" {
		t.Fatalf("edge body = %+v", body)
	}
}

func TestListAndGetRegisteredEdges(t *testing.T) {
	server := hubserver.New(hubserver.Config{Addr: ":0", Version: "test"})
	registerEdge(t, server, "local-edge")

	listReq := httptest.NewRequest(http.MethodGet, "/v1/edges", nil)
	listRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d: %s", listRec.Code, http.StatusOK, listRec.Body.String())
	}

	var listBody struct {
		Items []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"items"`
		Page struct {
			HasMore bool `json:"hasMore"`
		} `json:"page"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("list response is not JSON: %v", err)
	}
	if len(listBody.Items) != 1 {
		t.Fatalf("edge count = %d, want 1", len(listBody.Items))
	}
	if listBody.Items[0].Name != "local-edge" {
		t.Fatalf("edge name = %q, want local-edge", listBody.Items[0].Name)
	}
	if listBody.Page.HasMore {
		t.Fatal("hasMore = true, want false")
	}

	getReq := httptest.NewRequest(http.MethodGet, "/v1/edges/"+listBody.Items[0].ID, nil)
	getRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("get status = %d, want %d: %s", getRec.Code, http.StatusOK, getRec.Body.String())
	}
}

func TestHeartbeatEdgeMarksEdgeOnline(t *testing.T) {
	server := hubserver.New(hubserver.Config{Addr: ":0", Version: "test"})
	edgeID := registerEdge(t, server, "local-edge")

	req := httptest.NewRequest(http.MethodPost, "/v1/edges/"+edgeID+":heartbeat", strings.NewReader(`{"status":"online"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusAccepted, rec.Body.String())
	}

	var body struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if body.ID != edgeID || body.Status != "online" {
		t.Fatalf("heartbeat body = %+v", body)
	}
}

func TestRegisterEdgeRejectsMissingName(t *testing.T) {
	server := hubserver.New(hubserver.Config{Addr: ":0", Version: "test"})

	req := httptest.NewRequest(http.MethodPost, "/v1/edges:register", strings.NewReader(`{"endpoint":"http://127.0.0.1:8081"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}

	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if body.Error.Code != "bad_request" {
		t.Fatalf("code = %q, want bad_request", body.Error.Code)
	}
}

func TestSyncUploadListAckAndState(t *testing.T) {
	server := hubserver.New(hubserver.Config{Addr: ":0", Version: "test"})

	uploadReq := httptest.NewRequest(http.MethodPost, "/v1/sync/events:upload", strings.NewReader(`{
		"events": [{
			"version": "v1",
			"id": "evt_1",
			"seq": 1,
			"type": "edge.heartbeat",
			"scope": {"edgeId": "edge_1"},
			"sentAt": "2026-05-22T12:00:00Z",
			"payload": {"status": "online"}
		}]
	}`))
	uploadReq.Header.Set("Content-Type", "application/json")
	uploadRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(uploadRec, uploadReq)

	if uploadRec.Code != http.StatusAccepted {
		t.Fatalf("upload status = %d, want %d: %s", uploadRec.Code, http.StatusAccepted, uploadRec.Body.String())
	}

	var uploadBody struct {
		Accepted   int    `json:"accepted"`
		NextCursor string `json:"nextCursor"`
	}
	if err := json.Unmarshal(uploadRec.Body.Bytes(), &uploadBody); err != nil {
		t.Fatalf("upload response is not JSON: %v", err)
	}
	if uploadBody.Accepted != 1 || uploadBody.NextCursor == "" {
		t.Fatalf("upload body = %+v", uploadBody)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/sync/events", nil)
	listRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d: %s", listRec.Code, http.StatusOK, listRec.Body.String())
	}

	var listBody struct {
		Items []struct {
			Cursor string `json:"cursor"`
			Event  struct {
				ID     string    `json:"id"`
				Type   string    `json:"type"`
				SentAt time.Time `json:"sentAt"`
			} `json:"event"`
		} `json:"items"`
		Page struct {
			NextCursor string `json:"nextCursor"`
			HasMore    bool   `json:"hasMore"`
		} `json:"page"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("list response is not JSON: %v", err)
	}
	if len(listBody.Items) != 1 {
		t.Fatalf("sync event count = %d, want 1", len(listBody.Items))
	}
	if listBody.Items[0].Cursor != uploadBody.NextCursor || listBody.Items[0].Event.ID != "evt_1" {
		t.Fatalf("list body = %+v", listBody)
	}
	if listBody.Page.NextCursor != uploadBody.NextCursor || listBody.Page.HasMore {
		t.Fatalf("list page = %+v", listBody.Page)
	}

	ackReq := httptest.NewRequest(http.MethodPost, "/v1/sync/ack", strings.NewReader(`{"cursor":"`+uploadBody.NextCursor+`"}`))
	ackReq.Header.Set("Content-Type", "application/json")
	ackRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(ackRec, ackReq)

	if ackRec.Code != http.StatusAccepted {
		t.Fatalf("ack status = %d, want %d: %s", ackRec.Code, http.StatusAccepted, ackRec.Body.String())
	}

	var ackBody struct {
		LastCursor    string `json:"lastCursor"`
		LastAckCursor string `json:"lastAckCursor"`
		Pending       int    `json:"pending"`
	}
	if err := json.Unmarshal(ackRec.Body.Bytes(), &ackBody); err != nil {
		t.Fatalf("ack response is not JSON: %v", err)
	}
	if ackBody.LastAckCursor != uploadBody.NextCursor || ackBody.Pending != 0 {
		t.Fatalf("ack body = %+v", ackBody)
	}

	stateReq := httptest.NewRequest(http.MethodGet, "/v1/sync/state", nil)
	stateRec := httptest.NewRecorder()
	server.Handler().ServeHTTP(stateRec, stateReq)

	if stateRec.Code != http.StatusOK {
		t.Fatalf("state status = %d, want %d: %s", stateRec.Code, http.StatusOK, stateRec.Body.String())
	}
}

func TestSyncUploadRejectsInvalidEnvelope(t *testing.T) {
	server := hubserver.New(hubserver.Config{Addr: ":0", Version: "test"})

	req := httptest.NewRequest(http.MethodPost, "/v1/sync/events:upload", strings.NewReader(`{
		"events": [{
			"version": "v1",
			"id": "evt_1",
			"seq": 0,
			"type": "edge.heartbeat",
			"scope": {"edgeId": "edge_1"},
			"sentAt": "2026-05-22T12:00:00Z",
			"payload": {"status": "online"}
		}]
	}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func registerEdge(t *testing.T, server *hubserver.Server, name string) string {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/v1/edges:register", strings.NewReader(`{"name":"`+name+`"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("register status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var body struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("register response is not JSON: %v", err)
	}
	if body.ID == "" {
		t.Fatal("registered edge id is empty")
	}
	return body.ID
}
