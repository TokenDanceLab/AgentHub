package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// ObjectStorage abstracts blob storage for attachment content.
// LocalStorage implements it with the local filesystem; S3Storage
// implements it with any S3-compatible object store.
type ObjectStorage interface {
	// Put stores a blob at the given key. Returns (true, nil) when a
	// new blob was created, (false, nil) when it already existed.
	Put(ctx context.Context, key string, body io.Reader, contentType string) (bool, error)

	// Get retrieves a blob by key. The caller must close the reader.
	Get(ctx context.Context, key string) (io.ReadCloser, error)

	// Delete removes a blob by key. Deleting a non-existent key is a no-op.
	Delete(ctx context.Context, key string) error

	// LocalPath returns the filesystem path for the given key when the
	// storage is backed by a local directory. Returns an empty string
	// when the storage is remote (e.g. S3).
	LocalPath(key string) string
}

// ── LocalStorage ────────────────────────────────────────────────────────────

// LocalStorage stores attachment blobs on the local filesystem under the
// current working directory, matching the existing Upload.Dir-relative layout.
type LocalStorage struct{}

func NewLocalStorage() *LocalStorage {
	return &LocalStorage{}
}

func (s *LocalStorage) Put(ctx context.Context, key string, body io.Reader, contentType string) (bool, error) {
	absPath := filepath.Join(".", key)
	dir := filepath.Dir(absPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return false, err
	}

	dst, err := os.OpenFile(absPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		if os.IsExist(err) {
			return false, nil // already exists
		}
		return false, err
	}

	keep := false
	defer func() {
		if !keep {
			_ = os.Remove(absPath)
		}
	}()

	if _, err := io.Copy(dst, body); err != nil {
		_ = dst.Close()
		return true, err
	}
	if err := dst.Close(); err != nil {
		return true, err
	}

	keep = true
	return true, nil
}

func (s *LocalStorage) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	absPath := filepath.Join(".", key)
	return os.Open(absPath)
}

func (s *LocalStorage) Delete(ctx context.Context, key string) error {
	absPath := filepath.Join(".", key)
	if err := os.Remove(absPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *LocalStorage) LocalPath(key string) string {
	return filepath.Join(".", key)
}

// ── S3Storage ───────────────────────────────────────────────────────────────

// S3Storage stores attachment blobs in an S3-compatible object store.
type S3Storage struct {
	putObject    func(ctx context.Context, bucket, key string, body io.Reader, contentType string) error
	getObject    func(ctx context.Context, bucket, key string) (io.ReadCloser, error)
	deleteObject func(ctx context.Context, bucket, key string) error
	bucket       string
}

// NewS3Storage creates an S3Storage backed by injected S3 operations.
// Callers in production should inject real s3.Client calls via NewS3StorageFromConfig;
// tests may inject mock functions directly.
func NewS3Storage(
	putObject func(ctx context.Context, bucket, key string, body io.Reader, contentType string) error,
	getObject func(ctx context.Context, bucket, key string) (io.ReadCloser, error),
	deleteObject func(ctx context.Context, bucket, key string) error,
	bucket string,
) *S3Storage {
	return &S3Storage{
		putObject:    putObject,
		getObject:    getObject,
		deleteObject: deleteObject,
		bucket:       bucket,
	}
}

func (s *S3Storage) Put(ctx context.Context, key string, body io.Reader, contentType string) (bool, error) {
	if err := s.putObject(ctx, s.bucket, key, body, contentType); err != nil {
		return false, err
	}
	return true, nil
}

func (s *S3Storage) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	return s.getObject(ctx, s.bucket, key)
}

func (s *S3Storage) Delete(ctx context.Context, key string) error {
	return s.deleteObject(ctx, s.bucket, key)
}

func (s *S3Storage) LocalPath(key string) string {
	return "" // remote storage, no local path
}

// ── AttachmentService ───────────────────────────────────────────────────────

type AttachmentService struct {
	db        *gorm.DB
	uploadCfg config.UploadConfig
	storage   ObjectStorage
}

func NewAttachmentService(db *gorm.DB, uploadCfg config.UploadConfig, storage ObjectStorage) *AttachmentService {
	return &AttachmentService{db: db, uploadCfg: uploadCfg, storage: storage}
}

func (s *AttachmentService) ProbeAttachment(ctx context.Context, userID, hash string) (*model.Attachment, error) {
	if userID == "" {
		return nil, nil
	}
	a, err := repository.GetAttachmentByUploaderAndHash(s.db, userID, hash)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return a, nil
}

func (s *AttachmentService) SaveAttachment(ctx context.Context, uploaderID, hash, mimeType, originalName string, size int64) (*model.Attachment, error) {
	a := &model.Attachment{
		Hash:           hash,
		Size:           size,
		MimeType:       mimeType,
		OriginalName:   originalName,
		UploaderUserID: uploaderID,
	}
	if err := repository.CreateAttachment(s.db, a); err != nil {
		return nil, err
	}
	return a, nil
}

// StoreBlob writes attachment content to the configured object storage.
// It returns (true, nil) when a new blob was created, (false, nil) when
// a blob with the same hash already existed.
func (s *AttachmentService) StoreBlob(ctx context.Context, hash string, r io.Reader, contentType string) (bool, error) {
	key := PathFromHash(hash)
	if key == "" {
		return false, fmt.Errorf("invalid attachment hash: %s", hash)
	}
	return s.storage.Put(ctx, key, r, contentType)
}

// GetBlob retrieves attachment content from storage. The caller must close
// the returned reader.
func (s *AttachmentService) GetBlob(ctx context.Context, hash string) (io.ReadCloser, error) {
	key := PathFromHash(hash)
	if key == "" {
		return nil, fmt.Errorf("invalid attachment hash: %s", hash)
	}
	return s.storage.Get(ctx, key)
}

// DeleteBlob removes attachment content from storage.
func (s *AttachmentService) DeleteBlob(ctx context.Context, hash string) error {
	key := PathFromHash(hash)
	if key == "" {
		return nil
	}
	return s.storage.Delete(ctx, key)
}

// BlobLocalPath returns the filesystem path for the blob when using local
// storage. Returns an empty string for remote storage.
func (s *AttachmentService) BlobLocalPath(hash string) string {
	key := PathFromHash(hash)
	if key == "" {
		return ""
	}
	return s.storage.LocalPath(key)
}

func (s *AttachmentService) GetAttachmentByID(ctx context.Context, userID, id string) (*model.Attachment, error) {
	if userID == "" {
		return nil, errcode.AttachNotFound
	}
	a, err := repository.GetAttachmentByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AttachNotFound
		}
		return nil, err
	}
	if a.UploaderUserID == userID {
		return a, nil
	}

	allowed, err := repository.CanUserAccessReferencedAttachment(s.db, userID, id)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, errcode.AttachNotFound
	}
	return a, nil
}

func IsValidAttachmentHash(hash string) bool {
	if len(hash) != 64 {
		return false
	}
	if strings.ToLower(hash) != hash {
		return false
	}
	for _, r := range hash {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

func PathFromHash(hash string) string {
	if !IsValidAttachmentHash(hash) {
		return ""
	}
	return fmt.Sprintf("uploads/%s/%s/%s", hash[:2], hash[2:4], hash)
}

func (s *AttachmentService) MaxUploadSize() int64 {
	return s.uploadCfg.MaxSize
}
