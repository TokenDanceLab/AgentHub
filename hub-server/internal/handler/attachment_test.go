package handler_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

type mockAttachmentService struct {
	probeCalled      bool
	saveCalled       bool
	saveMimeType     string
	saveOriginalName string
	getAttachment    *model.Attachment
}

func (m *mockAttachmentService) ProbeAttachment(ctx context.Context, userID, hash string) (*model.Attachment, error) {
	m.probeCalled = true
	return nil, nil
}

func (m *mockAttachmentService) SaveAttachment(ctx context.Context, uploaderID, hash, mimeType, originalName string, size int64) (*model.Attachment, error) {
	m.saveCalled = true
	m.saveMimeType = mimeType
	m.saveOriginalName = originalName
	return &model.Attachment{Hash: hash, Size: size, MimeType: mimeType, OriginalName: originalName}, nil
}

func (m *mockAttachmentService) GetAttachmentByID(ctx context.Context, userID, id string) (*model.Attachment, error) {
	if m.getAttachment != nil {
		return m.getAttachment, nil
	}
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

func TestAttachmentUploadHashMismatchDoesNotModifyExistingBlob(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Chdir(t.TempDir())

	content := []byte("already stored content")
	uploadContent := []byte("different upload content")
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])
	relPath := service.PathFromHash(hash)
	if err := os.MkdirAll(relPath, 0755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	existingPath := filepath.Join(relPath, hash)
	if err := os.WriteFile(existingPath, content, 0644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	svc := &mockAttachmentService{}
	h := handler.NewAttachmentHandler(svc)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("hash", hash); err != nil {
		t.Fatalf("WriteField hash returned error: %v", err)
	}
	if err := writer.WriteField("original_name", "already.txt"); err != nil {
		t.Fatalf("WriteField original_name returned error: %v", err)
	}
	part, err := writer.CreateFormFile("file", "already.txt")
	if err != nil {
		t.Fatalf("CreateFormFile returned error: %v", err)
	}
	if _, err := part.Write(uploadContent); err != nil {
		t.Fatalf("part.Write returned error: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close returned error: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "other-user")
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
	if resp.Code != "ATTACH_HASH_MISMATCH" {
		t.Fatalf("expected ATTACH_HASH_MISMATCH, got %s", resp.Code)
	}
	if svc.saveCalled {
		t.Fatal("SaveAttachment should not be called for a mismatched hash")
	}
	got, err := os.ReadFile(existingPath)
	if err != nil {
		t.Fatalf("existing attachment blob should remain readable: %v", err)
	}
	if string(got) != string(content) {
		t.Fatalf("existing attachment blob changed: %q", got)
	}
}

func TestAttachmentUploadSniffsMimeTypeInsteadOfTrustingMultipartHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Chdir(t.TempDir())

	content := []byte("%PDF-1.7\n%test pdf bytes\n")
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])

	svc := &mockAttachmentService{}
	h := handler.NewAttachmentHandler(svc)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("hash", hash); err != nil {
		t.Fatalf("WriteField hash returned error: %v", err)
	}
	if err := writer.WriteField("original_name", "report.pdf"); err != nil {
		t.Fatalf("WriteField original_name returned error: %v", err)
	}
	partHeader := textproto.MIMEHeader{}
	partHeader.Set("Content-Disposition", `form-data; name="file"; filename="report.pdf"`)
	partHeader.Set("Content-Type", "text/plain")
	part, err := writer.CreatePart(partHeader)
	if err != nil {
		t.Fatalf("CreatePart returned error: %v", err)
	}
	if _, err := part.Write(content); err != nil {
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

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}
	if svc.saveMimeType != "application/pdf" {
		t.Fatalf("saved MIME type = %q, want application/pdf", svc.saveMimeType)
	}
}

func TestAttachmentDownloadFormatsUnsafeFilenameSafely(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Chdir(t.TempDir())

	content := []byte("download body")
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])
	relPath := service.PathFromHash(hash)
	if err := os.MkdirAll(relPath, 0755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	if err := os.WriteFile(filepath.Join(relPath, hash), content, 0644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	svc := &mockAttachmentService{
		getAttachment: &model.Attachment{
			ID:           "att-1",
			Hash:         hash,
			MimeType:     "text/plain",
			OriginalName: "evil\"\r\nX-Injected: yes.txt",
		},
	}
	h := handler.NewAttachmentHandler(svc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "user-1")
	c.Params = []gin.Param{{Key: "id", Value: "att-1"}}
	c.Request = httptest.NewRequest(http.MethodGet, "/client/attachments/att-1", nil)

	h.Download(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}
	disposition := w.Header().Get("Content-Disposition")
	if strings.ContainsAny(disposition, "\r\n") {
		t.Fatalf("Content-Disposition contains raw newline bytes: %q", disposition)
	}
	mediaType, params, err := mime.ParseMediaType(disposition)
	if err != nil {
		t.Fatalf("Content-Disposition is not parseable: %q: %v", disposition, err)
	}
	if mediaType != "attachment" {
		t.Fatalf("Content-Disposition media type = %q, want attachment", mediaType)
	}
	if params["filename"] == "" {
		t.Fatalf("Content-Disposition missing sanitized filename: %q", disposition)
	}
}
