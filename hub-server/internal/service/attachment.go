package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

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

	// PresignURL returns a direct-download URL for the key when supported
	// by the backing store. The caller provides already-safe response
	// headers for the object-store GET response.
	PresignURL(ctx context.Context, key string, contentType string, contentDisposition string, expiresIn time.Duration) (string, error)
}

// ── LocalStorage ────────────────────────────────────────────────────────────

// LocalStorage stores attachment blobs on the local filesystem under the
// configured upload directory (cfg.Upload.Dir), falling back to ".".
type LocalStorage struct {
	baseDir string
}

// NewLocalStorage returns a local filesystem storage rooted at baseDir.
// When baseDir is empty, "." (current working directory) is used as fallback.
func NewLocalStorage(baseDir string) *LocalStorage {
	if baseDir == "" {
		baseDir = "."
	}
	return &LocalStorage{baseDir: baseDir}
}

func (s *LocalStorage) Put(ctx context.Context, key string, body io.Reader, contentType string) (bool, error) {
	absPath := s.pathForKey(key)
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
	defer dst.Close()

	keep := false
	defer func() {
		if !keep {
			_ = os.Remove(absPath)
		}
	}()

	if _, err := io.Copy(dst, body); err != nil {
		return true, err
	}

	keep = true
	return true, nil
}

func (s *LocalStorage) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	absPath := s.pathForKey(key)
	return os.Open(absPath)
}

func (s *LocalStorage) Delete(ctx context.Context, key string) error {
	absPath := s.pathForKey(key)
	if err := os.Remove(absPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *LocalStorage) LocalPath(key string) string {
	return s.pathForKey(key)
}

func (s *LocalStorage) PresignURL(ctx context.Context, key string, contentType string, contentDisposition string, expiresIn time.Duration) (string, error) {
	return "", nil
}

func (s *LocalStorage) pathForKey(key string) string {
	return filepath.Join(s.baseDir, s.localKey(key))
}

func (s *LocalStorage) localKey(key string) string {
	if !strings.EqualFold(filepath.Base(filepath.Clean(s.baseDir)), "uploads") {
		return key
	}
	key = filepath.ToSlash(filepath.Clean(key))
	return strings.TrimPrefix(key, "uploads/")
}

// ── S3Storage ───────────────────────────────────────────────────────────────

// S3Storage stores attachment blobs in an S3-compatible object store.
type S3Storage struct {
	putObject    func(ctx context.Context, bucket, key string, body io.Reader, contentType string) (bool, error)
	getObject    func(ctx context.Context, bucket, key string) (io.ReadCloser, error)
	deleteObject func(ctx context.Context, bucket, key string) error
	presignURL   func(ctx context.Context, bucket, key, contentType, contentDisposition string, expiresIn time.Duration) (string, error)
	bucket       string
}

// NewS3Storage creates an S3Storage backed by injected S3 operations.
// Callers in production should inject real s3.Client calls via NewS3StorageFromConfig;
// tests may inject mock functions directly.
func NewS3Storage(
	putObject func(ctx context.Context, bucket, key string, body io.Reader, contentType string) (bool, error),
	getObject func(ctx context.Context, bucket, key string) (io.ReadCloser, error),
	deleteObject func(ctx context.Context, bucket, key string) error,
	presignURL func(ctx context.Context, bucket, key, contentType, contentDisposition string, expiresIn time.Duration) (string, error),
	bucket string,
) *S3Storage {
	return &S3Storage{
		putObject:    putObject,
		getObject:    getObject,
		deleteObject: deleteObject,
		presignURL:   presignURL,
		bucket:       bucket,
	}
}

func (s *S3Storage) Put(ctx context.Context, key string, body io.Reader, contentType string) (bool, error) {
	return s.putObject(ctx, s.bucket, key, body, contentType)
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

func (s *S3Storage) PresignURL(ctx context.Context, key string, contentType string, contentDisposition string, expiresIn time.Duration) (string, error) {
	if s.presignURL == nil {
		return "", nil
	}
	return s.presignURL(ctx, s.bucket, key, contentType, contentDisposition, expiresIn)
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
	return s.SaveAttachmentWithMetadata(ctx, uploaderID, hash, mimeType, originalName, size, "")
}

func (s *AttachmentService) SaveAttachmentWithMetadata(ctx context.Context, uploaderID, hash, mimeType, originalName string, size int64, metadata string) (*model.Attachment, error) {
	if !IsValidAttachmentHash(hash) {
		return nil, errcode.ErrBadRequest
	}
	normalizedMetadata, err := NormalizeAttachmentMetadataJSON(metadata)
	if err != nil {
		return nil, errcode.ErrBadRequest.WithMessage(err.Error())
	}

	// Hash-based dedup: if the same uploader already uploaded this hash,
	// return the existing attachment.
	if existing, err := repository.GetAttachmentByUploaderAndHash(s.db, uploaderID, hash); err == nil && existing != nil {
		return existing, nil
	}

	a := &model.Attachment{
		Hash:           hash,
		Size:           size,
		MimeType:       mimeType,
		OriginalName:   originalName,
		UploaderUserID: uploaderID,
		Metadata:       normalizedMetadata,
	}
	if err := repository.CreateAttachment(s.db, a); err != nil {
		return nil, err
	}
	return a, nil
}

func NormalizeAttachmentMetadataJSON(metadata string) (string, error) {
	metadata = strings.TrimSpace(metadata)
	if metadata == "" {
		return "{}", nil
	}

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(metadata), &payload); err != nil {
		return "", fmt.Errorf("metadata must be valid JSON: %w", err)
	}
	if payload == nil {
		return "", fmt.Errorf("metadata must be a JSON object")
	}

	normalized, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(normalized), nil
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

// PresignBlobURL returns a direct-download URL for remote storage when the
// configured object store supports presigned GET requests.
func (s *AttachmentService) PresignBlobURL(ctx context.Context, hash string, contentType string, contentDisposition string) (string, error) {
	key := PathFromHash(hash)
	if key == "" {
		return "", nil
	}
	return s.storage.PresignURL(ctx, key, contentType, contentDisposition, 15*time.Minute)
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
	// #81: Always verify active session membership — do not allow
	// uploader ownership alone to bypass the session member check.
	// This prevents users who are no longer active session members
	// from accessing attachments.
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
	if s.uploadCfg.MaxSize <= 0 {
		return config.DefaultMaxUploadSize
	}
	return s.uploadCfg.MaxSize
}

func (s *AttachmentService) IsAttachmentMimeTypeAllowed(mimeType string) bool {
	mediaType, _, err := mime.ParseMediaType(mimeType)
	if err != nil {
		mediaType = strings.TrimSpace(mimeType)
	}
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	if mediaType == "" {
		return false
	}

	allowedMimeTypes := s.uploadCfg.AllowedMimeTypes
	if len(allowedMimeTypes) == 0 {
		allowedMimeTypes = config.DefaultAllowedUploadMimeTypes
	}
	for _, allowed := range allowedMimeTypes {
		allowedMediaType, _, err := mime.ParseMediaType(allowed)
		if err != nil {
			allowedMediaType = strings.TrimSpace(allowed)
		}
		if mediaType == strings.ToLower(strings.TrimSpace(allowedMediaType)) {
			return true
		}
	}
	return false
}
