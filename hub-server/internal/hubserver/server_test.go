package hubserver_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
