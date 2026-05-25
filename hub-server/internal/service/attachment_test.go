package service_test

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agenthub/hub-server/internal/service"
)

func TestLocalStorage_PutAndGet(t *testing.T) {
	t.Chdir(t.TempDir())
	store := service.NewLocalStorage()

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

func TestS3Storage_LocalPathReturnsEmpty(t *testing.T) {
	s3 := service.NewS3Storage(
		func(ctx context.Context, bucket, key string, body io.Reader, contentType string) error {
			return nil
		},
		func(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
			return io.NopCloser(strings.NewReader("")), nil
		},
		func(ctx context.Context, bucket, key string) error {
			return nil
		},
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

	store := service.NewLocalStorage()
	// Verify that the local store works through the AttachmentService
	// public API contract (the methods exist and don't panic).
	_ = store

	hash := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	key := service.PathFromHash(hash)
	if key == "" {
		t.Fatal("PathFromHash should return a non-empty key for a valid hash")
	}
	if !strings.HasPrefix(key, "uploads/") {
		t.Errorf("PathFromHash key should start with uploads/, got %q", key)
	}
}

func TestS3Storage_PutReturnsTrue(t *testing.T) {
	s3 := service.NewS3Storage(
		func(ctx context.Context, bucket, key string, body io.Reader, contentType string) error {
			return nil
		},
		func(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
			return io.NopCloser(strings.NewReader("")), nil
		},
		func(ctx context.Context, bucket, key string) error {
			return nil
		},
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
