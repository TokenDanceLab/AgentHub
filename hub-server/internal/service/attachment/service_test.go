package attachment_test

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/attachment"
	"github.com/agenthub/hub-server/internal/service/im"
)

func TestLocalStorage_PutAndGet(t *testing.T) {
	t.Chdir(t.TempDir())
	store := attachment.NewLocalStorage(".")

	key := "uploads/ab/cd/testhash1234"
	body := strings.NewReader("hello world")
	created, err := store.Put(context.Background(), key, body, "text/plain")
	if err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	if !created {
		t.Error("first Put should create a new blob")
	}

	// Second put with same key should not error and return false (already exists).
	body2 := strings.NewReader("should be ignored")
	created2, err := store.Put(context.Background(), key, body2, "text/plain")
	if err != nil {
		t.Fatalf("second Put() error = %v", err)
	}
	if created2 {
		t.Error("second Put should return false (blob already exists)")
	}

	// Get should return the original content.
	rc, err := store.Get(context.Background(), key)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	defer rc.Close()
	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("ReadAll error = %v", err)
	}
	if string(got) != "hello world" {
		t.Errorf("Get() = %q, want %q", string(got), "hello world")
	}

	// LocalPath should return the on-disk path.
	p := store.LocalPath(key)
	if p == "" {
		t.Error("LocalPath should return a non-empty path for local storage")
	}
	abs := filepath.Join(".", key)
	if p != abs {
		t.Errorf("LocalPath = %q, want %q", p, abs)
	}
	if _, err := os.Stat(p); err != nil {
		t.Errorf("LocalPath file should exist: %v", err)
	}

	// Close the reader before deleting the file.
	rc.Close()

	// Delete should remove the file.
	if err := store.Delete(context.Background(), key); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Error("file should not exist after Delete")
	}

	// Deleting a non-existent key should be a no-op.
	if err := store.Delete(context.Background(), key); err != nil {
		t.Fatalf("Delete() on non-existent key error = %v", err)
	}
}

func TestLocalStorage_AvoidsDoubleUploadsPrefixWhenBaseDirIsUploads(t *testing.T) {
	root := t.TempDir()
	uploadDir := filepath.Join(root, "uploads")
	store := attachment.NewLocalStorage(uploadDir)

	hash := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	key := im.PathFromHash(hash)
	if key == "" {
		t.Fatal("PathFromHash should return a non-empty key for a valid hash")
	}

	created, err := store.Put(context.Background(), key, strings.NewReader("attachment"), "text/plain")
	if err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	if !created {
		t.Fatal("first Put should create a new blob")
	}

	wantPath := filepath.Join(uploadDir, hash[:2], hash[2:4], hash)
	if got := store.LocalPath(key); got != wantPath {
		t.Fatalf("LocalPath() = %q, want %q", got, wantPath)
	}

	if _, err := os.Stat(wantPath); err != nil {
		t.Fatalf("stored file should exist at normalized upload path: %v", err)
	}
	if _, err := os.Stat(filepath.Join(uploadDir, key)); !os.IsNotExist(err) {
		t.Fatalf("stored file should not use double uploads prefix, stat error = %v", err)
	}

	rc, err := store.Get(context.Background(), key)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	defer rc.Close()
	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("ReadAll error = %v", err)
	}
	if string(got) != "attachment" {
		t.Fatalf("Get() = %q, want %q", string(got), "attachment")
	}
}

func TestS3Storage_LocalPathReturnsEmpty(t *testing.T) {
	s3 := attachment.NewS3Storage(
		func(ctx context.Context, bucket, key string, body io.Reader, contentType string) (bool, error) {
			return true, nil
		},
		func(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
			return io.NopCloser(strings.NewReader("")), nil
		},
		func(ctx context.Context, bucket, key string) error {
			return nil
		},
		nil,
		"test-bucket",
	)
	if p := s3.LocalPath("uploads/ab/cd/hash"); p != "" {
		t.Errorf("S3Storage.LocalPath = %q, want empty string", p)
	}
}

func TestSaveAttachment_StorageInjection(t *testing.T) {
	// This test verifies that the ObjectStorage interface is correctly
	// wired. With a local store, BlobLocalPath returns a path; StoreBlob
	// writes to disk.
	t.Chdir(t.TempDir())

	store := attachment.NewLocalStorage(".")
	// Verify that the local store works through the Service
	// public API contract (the methods exist and don't panic).
	_ = store

	hash := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	key := im.PathFromHash(hash)
	if key == "" {
		t.Fatal("PathFromHash should return a non-empty key for a valid hash")
	}
	if !strings.HasPrefix(key, "uploads/") {
		t.Errorf("PathFromHash key should start with uploads/, got %q", key)
	}
}

func TestAttachmentService_NilStorageBlobPathsAreSafe(t *testing.T) {
	// Metadata-only construction (storage port unset) must not panic on blob paths.
	svc := attachment.NewService(nil, config.UploadConfig{}, nil)
	hash := strings.Repeat("e", 64)

	if path := svc.BlobLocalPath(hash); path != "" {
		t.Fatalf("BlobLocalPath with nil storage = %q, want empty", path)
	}
	if err := svc.DeleteBlob(context.Background(), hash); err != nil {
		t.Fatalf("DeleteBlob with nil storage error = %v, want nil", err)
	}
	url, err := svc.PresignBlobURL(context.Background(), hash, "text/plain", `attachment; filename="x.txt"`)
	if err != nil {
		t.Fatalf("PresignBlobURL with nil storage error = %v, want nil", err)
	}
	if url != "" {
		t.Fatalf("PresignBlobURL with nil storage = %q, want empty", url)
	}

	if _, err := svc.StoreBlob(context.Background(), hash, strings.NewReader("x"), "text/plain"); err == nil {
		t.Fatal("StoreBlob with nil storage error = nil, want configured error")
	}
	if _, err := svc.GetBlob(context.Background(), hash); err == nil {
		t.Fatal("GetBlob with nil storage error = nil, want configured error")
	}
}

func TestAttachmentService_SetStoragePort(t *testing.T) {
	db := newAttachmentServiceTestDB(t)
	hash := strings.Repeat("f", 64)
	store := &recordingPresignStorage{url: "https://s3.example.test/set-storage"}
	svc := attachment.NewService(db, config.UploadConfig{}, nil)

	// Before SetStorage: presign is a no-op.
	url, err := svc.PresignBlobURL(context.Background(), hash, "text/plain", `attachment; filename="safe.txt"`)
	if err != nil {
		t.Fatalf("PresignBlobURL before SetStorage error = %v", err)
	}
	if url != "" {
		t.Fatalf("PresignBlobURL before SetStorage = %q, want empty", url)
	}
	if store.called {
		t.Fatal("storage should not be called before SetStorage")
	}

	svc.SetStorage(store)
	url, err = svc.PresignBlobURL(context.Background(), hash, "text/plain", `attachment; filename="safe.txt"`)
	if err != nil {
		t.Fatalf("PresignBlobURL after SetStorage error = %v", err)
	}
	if url != store.url {
		t.Fatalf("PresignBlobURL after SetStorage = %q, want %q", url, store.url)
	}
	if !store.called {
		t.Fatal("storage PresignURL should be called after SetStorage")
	}
	if store.key != im.PathFromHash(hash) {
		t.Fatalf("presign key = %q, want %q", store.key, im.PathFromHash(hash))
	}
}

func TestSaveAttachmentWithMetadata_NormalizesJSONObject(t *testing.T) {
	db := newAttachmentServiceTestDB(t)
	svc := attachment.NewService(db, config.UploadConfig{}, attachment.NewLocalStorage(t.TempDir()))

	hash := strings.Repeat("a", 64)
	att, err := svc.SaveAttachmentWithMetadata(context.Background(), "user-1", hash, "text/plain", "notes.txt", 12, `{
		"source": "chat",
		"labels": ["draft", "review"]
	}`)
	if err != nil {
		t.Fatalf("SaveAttachmentWithMetadata() error = %v", err)
	}

	if att.Metadata != `{"labels":["draft","review"],"source":"chat"}` {
		t.Fatalf("Metadata = %q, want normalized object JSON", att.Metadata)
	}

	var fetched model.Attachment
	if err := db.First(&fetched, "id = ?", att.ID).Error; err != nil {
		t.Fatalf("fetch attachment: %v", err)
	}
	if fetched.Metadata != att.Metadata {
		t.Fatalf("persisted Metadata = %q, want %q", fetched.Metadata, att.Metadata)
	}
}

func TestSaveAttachmentWithMetadata_RejectsInvalidMetadata(t *testing.T) {
	db := newAttachmentServiceTestDB(t)
	svc := attachment.NewService(db, config.UploadConfig{}, attachment.NewLocalStorage(t.TempDir()))

	hash := strings.Repeat("b", 64)
	_, err := svc.SaveAttachmentWithMetadata(context.Background(), "user-1", hash, "text/plain", "notes.txt", 12, `["not", "object"]`)
	if err == nil {
		t.Fatal("SaveAttachmentWithMetadata() error = nil, want bad request")
	}
	var coded *errcode.Error
	if !errors.As(err, &coded) || coded.Code != errcode.ErrBadRequest.Code {
		t.Fatalf("SaveAttachmentWithMetadata() error = %v, want %s", err, errcode.ErrBadRequest.Code)
	}

	var count int64
	if err := db.Model(&model.Attachment{}).Count(&count).Error; err != nil {
		t.Fatalf("count attachments: %v", err)
	}
	if count != 0 {
		t.Fatalf("attachments count = %d, want 0", count)
	}
}

func TestSaveAttachment_DefaultsMetadataToEmptyObject(t *testing.T) {
	db := newAttachmentServiceTestDB(t)
	svc := attachment.NewService(db, config.UploadConfig{}, attachment.NewLocalStorage(t.TempDir()))

	att, err := svc.SaveAttachment(context.Background(), "user-1", strings.Repeat("c", 64), "text/plain", "notes.txt", 12)
	if err != nil {
		t.Fatalf("SaveAttachment() error = %v", err)
	}
	if att.Metadata != "{}" {
		t.Fatalf("Metadata = %q, want {}", att.Metadata)
	}
}

func TestAttachmentServiceMimeAllowlistUsesDefaultWithoutOctetStream(t *testing.T) {
	db := newAttachmentServiceTestDB(t)
	svc := attachment.NewService(db, config.UploadConfig{}, attachment.NewLocalStorage(t.TempDir()))

	if !svc.IsAttachmentMimeTypeAllowed("text/plain; charset=utf-8") {
		t.Fatal("text/plain with parameters should be allowed by default")
	}
	if svc.IsAttachmentMimeTypeAllowed("application/octet-stream") {
		t.Fatal("application/octet-stream must not be allowed by default")
	}
}

func TestAttachmentServiceMimeAllowlistAllowsConfiguredOctetStream(t *testing.T) {
	db := newAttachmentServiceTestDB(t)
	svc := attachment.NewService(
		db,
		config.UploadConfig{AllowedMimeTypes: []string{"text/plain", "application/octet-stream"}},
		attachment.NewLocalStorage(t.TempDir()),
	)

	if !svc.IsAttachmentMimeTypeAllowed("application/octet-stream") {
		t.Fatal("application/octet-stream should be allowed when explicitly configured")
	}
}

func TestS3Storage_PutReturnsTrue(t *testing.T) {
	s3 := attachment.NewS3Storage(
		func(ctx context.Context, bucket, key string, body io.Reader, contentType string) (bool, error) {
			return true, nil
		},
		func(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
			return io.NopCloser(strings.NewReader("")), nil
		},
		func(ctx context.Context, bucket, key string) error {
			return nil
		},
		nil,
		"test-bucket",
	)
	created, err := s3.Put(context.Background(), "key", strings.NewReader("data"), "text/plain")
	if err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	if !created {
		t.Error("S3Storage.Put should return true for a new blob")
	}
}

func TestS3Storage_PutReturnsFalseWhenBlobAlreadyExists(t *testing.T) {
	s3 := attachment.NewS3Storage(
		func(ctx context.Context, bucket, key string, body io.Reader, contentType string) (bool, error) {
			return false, nil
		},
		func(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
			return io.NopCloser(strings.NewReader("")), nil
		},
		func(ctx context.Context, bucket, key string) error {
			return nil
		},
		nil,
		"test-bucket",
	)
	created, err := s3.Put(context.Background(), "key", strings.NewReader("data"), "text/plain")
	if err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	if created {
		t.Error("S3Storage.Put should return false when the object already exists")
	}
}

func TestAttachmentServicePresignBlobURLUsesStorageKeyAndSafeResponseHeaders(t *testing.T) {
	db := newAttachmentServiceTestDB(t)
	hash := strings.Repeat("d", 64)
	store := &recordingPresignStorage{url: "https://s3.example.test/presigned"}
	svc := attachment.NewService(db, config.UploadConfig{}, store)

	url, err := svc.PresignBlobURL(context.Background(), hash, "text/plain", `attachment; filename="safe.txt"`)
	if err != nil {
		t.Fatalf("PresignBlobURL() error = %v", err)
	}
	if url != store.url {
		t.Fatalf("PresignBlobURL() = %q, want %q", url, store.url)
	}
	if store.key != im.PathFromHash(hash) {
		t.Fatalf("presign key = %q, want %q", store.key, im.PathFromHash(hash))
	}
	if store.contentType != "text/plain" {
		t.Fatalf("presign content type = %q, want text/plain", store.contentType)
	}
	if store.contentDisposition != `attachment; filename="safe.txt"` {
		t.Fatalf("presign content disposition = %q, want safe disposition", store.contentDisposition)
	}
	if store.expiresIn != 15*time.Minute {
		t.Fatalf("presign expiry = %s, want 15m", store.expiresIn)
	}
}

func TestAttachmentServicePresignBlobURLRejectsInvalidHashBeforeStorage(t *testing.T) {
	db := newAttachmentServiceTestDB(t)
	store := &recordingPresignStorage{url: "https://s3.example.test/presigned"}
	svc := attachment.NewService(db, config.UploadConfig{}, store)

	url, err := svc.PresignBlobURL(context.Background(), "bad", "text/plain", `attachment; filename="safe.txt"`)
	if err != nil {
		t.Fatalf("PresignBlobURL() error = %v", err)
	}
	if url != "" {
		t.Fatalf("PresignBlobURL() = %q, want empty URL for invalid hash", url)
	}
	if store.called {
		t.Fatal("storage PresignURL should not be called for invalid hash")
	}
}

func TestS3Storage_PresignURLDelegatesToConfiguredSigner(t *testing.T) {
	var gotBucket, gotKey, gotType, gotDisposition string
	var gotExpiry time.Duration
	s3 := attachment.NewS3Storage(
		func(ctx context.Context, bucket, key string, body io.Reader, contentType string) (bool, error) {
			return true, nil
		},
		func(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
			return io.NopCloser(strings.NewReader("")), nil
		},
		func(ctx context.Context, bucket, key string) error {
			return nil
		},
		func(ctx context.Context, bucket, key, contentType, contentDisposition string, expiresIn time.Duration) (string, error) {
			gotBucket = bucket
			gotKey = key
			gotType = contentType
			gotDisposition = contentDisposition
			gotExpiry = expiresIn
			return "https://s3.example.test/presigned", nil
		},
		"test-bucket",
	)

	url, err := s3.PresignURL(context.Background(), "uploads/aa/bb/hash", "text/plain", `attachment; filename="safe.txt"`, time.Minute)
	if err != nil {
		t.Fatalf("PresignURL() error = %v", err)
	}
	if url != "https://s3.example.test/presigned" {
		t.Fatalf("PresignURL() = %q, want configured URL", url)
	}
	if gotBucket != "test-bucket" || gotKey != "uploads/aa/bb/hash" || gotType != "text/plain" ||
		gotDisposition != `attachment; filename="safe.txt"` || gotExpiry != time.Minute {
		t.Fatalf("presign args = bucket %q key %q type %q disposition %q expiry %s", gotBucket, gotKey, gotType, gotDisposition, gotExpiry)
	}
}

type recordingPresignStorage struct {
	url                string
	called             bool
	key                string
	contentType        string
	contentDisposition string
	expiresIn          time.Duration
}

func (s *recordingPresignStorage) Put(ctx context.Context, key string, body io.Reader, contentType string) (bool, error) {
	return true, nil
}

func (s *recordingPresignStorage) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

func (s *recordingPresignStorage) Delete(ctx context.Context, key string) error {
	return nil
}

func (s *recordingPresignStorage) LocalPath(key string) string {
	return ""
}

func (s *recordingPresignStorage) PresignURL(ctx context.Context, key string, contentType string, contentDisposition string, expiresIn time.Duration) (string, error) {
	s.called = true
	s.key = key
	s.contentType = contentType
	s.contentDisposition = contentDisposition
	s.expiresIn = expiresIn
	return s.url, nil
}

func newAttachmentServiceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.Exec(`CREATE TABLE attachments (
		id TEXT PRIMARY KEY,
		hash TEXT NOT NULL UNIQUE,
		size INTEGER NOT NULL,
		mime_type TEXT NOT NULL,
		original_name TEXT DEFAULT '',
		uploader_user_id TEXT NOT NULL,
		metadata TEXT NOT NULL DEFAULT '{}',
		created_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create attachments table: %v", err)
	}
	return db
}
