//nolint:gosec // 测试 fixture：凭据模式字符串用于构造测试用例，非真实凭据
package handler_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
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
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/attachment"
	"github.com/agenthub/hub-server/internal/service/im"
)

type mockAttachmentService struct {
	probeCalled        bool
	saveCalled         bool
	storeCalled        bool
	getBlobCalled      bool
	saveMimeType       string
	saveOriginalName   string
	saveMetadata       string
	getAttachment      *model.Attachment
	allowedMimeTypes   map[string]bool
	remoteStorage      bool
	presignURL         string
	presignHash        string
	presignType        string
	presignDisposition string
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

func (m *mockAttachmentService) SaveAttachmentWithMetadata(ctx context.Context, uploaderID, hash, mimeType, originalName string, size int64, metadata string) (*model.Attachment, error) {
	m.saveCalled = true
	m.saveMimeType = mimeType
	m.saveOriginalName = originalName
	m.saveMetadata = metadata
	return &model.Attachment{Hash: hash, Size: size, MimeType: mimeType, OriginalName: originalName, Metadata: metadata}, nil
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

func (m *mockAttachmentService) StoreBlob(ctx context.Context, hash string, r io.Reader, contentType string) (bool, error) {
	m.storeCalled = true
	return true, nil
}

func (m *mockAttachmentService) GetBlob(ctx context.Context, hash string) (io.ReadCloser, error) {
	m.getBlobCalled = true
	return io.NopCloser(strings.NewReader("")), nil
}

func (m *mockAttachmentService) DeleteBlob(ctx context.Context, hash string) error {
	return nil
}

func (m *mockAttachmentService) BlobLocalPath(hash string) string {
	if m.remoteStorage {
		return ""
	}
	relPath := im.PathFromHash(hash)
	if relPath == "" {
		return ""
	}
	return filepath.Join(".", relPath, hash)
}

func (m *mockAttachmentService) PresignBlobURL(ctx context.Context, hash string, contentType string, contentDisposition string) (string, error) {
	m.presignHash = hash
	m.presignType = contentType
	m.presignDisposition = contentDisposition
	return m.presignURL, nil
}

func (m *mockAttachmentService) IsAttachmentMimeTypeAllowed(mimeType string) bool {
	if m.allowedMimeTypes == nil {
		return true
	}
	return m.allowedMimeTypes[mimeType]
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
	var resp struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Error.Code != "bad_request" {
		t.Fatalf("expected BAD_REQUEST, got %s", resp.Error.Code)
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
	relPath := im.PathFromHash(hash)
	if err := os.MkdirAll(relPath, 0755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	existingPath := filepath.Join(relPath, hash)
	if err := os.WriteFile(existingPath, content, 0o600); err != nil {
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
	var resp struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Error.Code != "attach_hash_mismatch" {
		t.Fatalf("expected attach_hash_mismatch, got %s", resp.Error.Code)
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

func TestAttachmentUploadRejectsDisallowedSniffedMimeBeforeStorage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Chdir(t.TempDir())

	content := []byte("opaque binary payload")
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])

	svc := &mockAttachmentService{allowedMimeTypes: map[string]bool{
		"text/plain": false,
	}}
	h := handler.NewAttachmentHandler(svc)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("hash", hash); err != nil {
		t.Fatalf("WriteField hash returned error: %v", err)
	}
	if err := writer.WriteField("original_name", "payload.bin"); err != nil {
		t.Fatalf("WriteField original_name returned error: %v", err)
	}
	part, err := writer.CreateFormFile("file", "payload.bin")
	if err != nil {
		t.Fatalf("CreateFormFile returned error: %v", err)
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

	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected status 415, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Error.Code != "attach_type_not_allowed" {
		t.Fatalf("expected attach_type_not_allowed, got %s", resp.Error.Code)
	}
	if svc.storeCalled {
		t.Fatal("StoreBlob should not be called for a disallowed MIME type")
	}
	if svc.saveCalled {
		t.Fatal("SaveAttachment should not be called for a disallowed MIME type")
	}
}

func TestAttachmentUploadExtractsPNGDimensionsIntoMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Chdir(t.TempDir())

	content := makePNGAttachmentBytes(t, 2, 3)
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])

	svc := &mockAttachmentService{}
	h := handler.NewAttachmentHandler(svc)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("hash", hash); err != nil {
		t.Fatalf("WriteField hash returned error: %v", err)
	}
	if err := writer.WriteField("original_name", "preview.png"); err != nil {
		t.Fatalf("WriteField original_name returned error: %v", err)
	}
	part, err := writer.CreateFormFile("file", "preview.png")
	if err != nil {
		t.Fatalf("CreateFormFile returned error: %v", err)
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
	if svc.saveMimeType != "image/png" {
		t.Fatalf("saved MIME type = %q, want image/png", svc.saveMimeType)
	}
	if svc.saveMetadata != `{"height":3,"width":2}` {
		t.Fatalf("saved metadata = %q, want PNG dimensions", svc.saveMetadata)
	}
}

func TestAttachmentUploadUsesConfiguredLocalStorageDir(t *testing.T) {
	gin.SetMode(gin.TestMode)
	workDir := t.TempDir()
	t.Chdir(workDir)
	uploadDir := filepath.Join(t.TempDir(), "configured-uploads")

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Attachment{}); err != nil {
		t.Fatalf("migrate attachments: %v", err)
	}

	content := []byte("configured upload directory content")
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])

	svc := attachment.NewService(
		db,
		config.UploadConfig{Dir: uploadDir, MaxSize: 1024},
		attachment.NewLocalStorage(uploadDir),
	)
	h := handler.NewAttachmentHandler(svc)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("hash", hash); err != nil {
		t.Fatalf("WriteField hash returned error: %v", err)
	}
	if err := writer.WriteField("original_name", "configured.txt"); err != nil {
		t.Fatalf("WriteField original_name returned error: %v", err)
	}
	part, err := writer.CreateFormFile("file", "configured.txt")
	if err != nil {
		t.Fatalf("CreateFormFile returned error: %v", err)
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
	storedPath := filepath.Join(uploadDir, im.PathFromHash(hash))
	got, err := os.ReadFile(storedPath)
	if err != nil {
		t.Fatalf("configured upload blob should be readable at %s: %v", storedPath, err)
	}
	if string(got) != string(content) {
		t.Fatalf("stored upload content = %q, want %q", got, content)
	}
	if _, err := os.Stat(filepath.Join(workDir, "uploads")); !os.IsNotExist(err) {
		t.Fatalf("upload handler created cwd uploads directory despite configured upload dir: %v", err)
	}
}

func makePNGAttachmentBytes(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	img.Set(width-1, height-1, color.RGBA{G: 255, A: 255})

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode returned error: %v", err)
	}
	return buf.Bytes()
}

func TestAttachmentDownloadFormatsUnsafeFilenameSafely(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Chdir(t.TempDir())

	content := []byte("download body")
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])
	relPath := im.PathFromHash(hash)
	if err := os.MkdirAll(relPath, 0755); err != nil {
		t.Fatalf("MkdirAll returned error: %v", err)
	}
	if err := os.WriteFile(filepath.Join(relPath, hash), content, 0o600); err != nil {
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

func TestAttachmentDownloadRedirectsToPresignedRemoteURLWithSafeDisposition(t *testing.T) {
	gin.SetMode(gin.TestMode)

	content := []byte("remote body")
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])

	svc := &mockAttachmentService{
		remoteStorage: true,
		presignURL:    "https://s3.example.test/bucket/object?signature=abc",
		getAttachment: &model.Attachment{
			ID:           "att-remote",
			Hash:         hash,
			Size:         int64(len(content)),
			MimeType:     "text/plain; charset=utf-8",
			OriginalName: "..\\evil\"\r\nX-Injected: yes.txt",
		},
	}
	h := handler.NewAttachmentHandler(svc)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "user-1")
	c.Params = []gin.Param{{Key: "id", Value: "att-remote"}}
	c.Request = httptest.NewRequest(http.MethodGet, "/client/attachments/att-remote", nil)

	h.Download(c)

	if w.Code != http.StatusFound {
		t.Fatalf("expected status 302, got %d: %s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Location"); got != svc.presignURL {
		t.Fatalf("Location = %q, want presigned URL", got)
	}
	if svc.getBlobCalled {
		t.Fatal("GetBlob should not be called when presigned redirect is available")
	}
	if svc.presignHash != hash {
		t.Fatalf("presign hash = %q, want %q", svc.presignHash, hash)
	}
	if svc.presignType != "text/plain; charset=utf-8" {
		t.Fatalf("presign content type = %q, want sanitized attachment content type", svc.presignType)
	}
	if strings.ContainsAny(svc.presignDisposition, "\r\n") {
		t.Fatalf("presign disposition contains raw newline bytes: %q", svc.presignDisposition)
	}
	mediaType, params, err := mime.ParseMediaType(svc.presignDisposition)
	if err != nil {
		t.Fatalf("presign disposition is not parseable: %q: %v", svc.presignDisposition, err)
	}
	if mediaType != "attachment" {
		t.Fatalf("presign disposition media type = %q, want attachment", mediaType)
	}
	if params["filename"] != "evil\"X-Injected: yes.txt" {
		t.Fatalf("presign filename = %q, want sanitized base filename", params["filename"])
	}
}
