package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
)

type mockAttachmentService struct {
	probeCalled bool
	saveCalled  bool
}

func (m *mockAttachmentService) ProbeAttachment(ctx context.Context, hash string) (*model.Attachment, error) {
	m.probeCalled = true
	return nil, nil
}

func (m *mockAttachmentService) SaveAttachment(ctx context.Context, uploaderID, hash, mimeType, originalName string, size int64) (*model.Attachment, error) {
	m.saveCalled = true
	return &model.Attachment{Hash: hash, Size: size, MimeType: mimeType, OriginalName: originalName}, nil
}

func (m *mockAttachmentService) GetAttachmentByID(ctx context.Context, id string) (*model.Attachment, error) {
	return &model.Attachment{ID: id, Hash: "abc", OriginalName: "bad.txt", MimeType: "text/plain"}, nil
}

func (m *mockAttachmentService) MaxUploadSize() int64 {
	return 1024
}

func TestAttachmentUploadRejectsMalformedHashBeforePathDerivation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockAttachmentService{}
	h := handler.NewAttachmentHandler(svc)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("hash", "abc"); err != nil {
		t.Fatalf("WriteField returned error: %v", err)
	}
	part, err := writer.CreateFormFile("file", "note.txt")
	if err != nil {
		t.Fatalf("CreateFormFile returned error: %v", err)
	}
	if _, err := part.Write([]byte("hello")); err != nil {
		t.Fatalf("part.Write returned error: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close returned error: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "user-1")
	c.Request = httptest.NewRequest(http.MethodPost, "/client/attachments", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())

	h.Upload(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
	var resp handler.Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Code != "BAD_REQUEST" {
		t.Fatalf("expected BAD_REQUEST, got %s", resp.Code)
	}
	if svc.saveCalled {
		t.Fatal("SaveAttachment should not be called for malformed hash")
	}
}

func TestAttachmentProbeRejectsMalformedHashBeforeServiceLookup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockAttachmentService{}
	h := handler.NewAttachmentHandler(svc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/client/attachments/probe", bytes.NewReader([]byte(`{"hash":"abc"}`)))
	c.Request.Header.Set("Content-Type", "application/json")

	h.Probe(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
	if svc.probeCalled {
		t.Fatal("ProbeAttachment should not be called for malformed hash")
	}
}
