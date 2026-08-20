package handler

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/agenthub/hub-server/internal/service/im"
)

// AttachmentService is the subset of *attachment.Service used by AttachmentHandler.
type AttachmentService interface {
	ProbeAttachment(ctx context.Context, userID, hash string) (*model.Attachment, error)
	SaveAttachment(ctx context.Context, uploaderID, hash, mimeType, originalName string, size int64) (*model.Attachment, error)
	SaveAttachmentWithMetadata(ctx context.Context, uploaderID, hash, mimeType, originalName string, size int64, metadata string) (*model.Attachment, error)
	GetAttachmentByID(ctx context.Context, userID, id string) (*model.Attachment, error)
	MaxUploadSize() int64
	IsAttachmentMimeTypeAllowed(mimeType string) bool
	StoreBlob(ctx context.Context, hash string, r io.Reader, contentType string) (bool, error)
	GetBlob(ctx context.Context, hash string) (io.ReadCloser, error)
	DeleteBlob(ctx context.Context, hash string) error
	BlobLocalPath(hash string) string
	PresignBlobURL(ctx context.Context, hash string, contentType string, contentDisposition string) (string, error)
}

type AttachmentHandler struct {
	service AttachmentService
}

func NewAttachmentHandler(s AttachmentService) *AttachmentHandler {
	return &AttachmentHandler{service: s}
}

type probeReq struct {
	Hash string `json:"hash" binding:"required"`
}

func (h *AttachmentHandler) Probe(c *gin.Context) {
	var req probeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	if !im.IsValidAttachmentHash(req.Hash) {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	userID := c.GetString("user_id")
	a, err := h.service.ProbeAttachment(c.Request.Context(), userID, req.Hash)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}

	OK(c, gin.H{
		"exists":     a != nil,
		"attachment": a,
	})
}

func (h *AttachmentHandler) Upload(c *gin.Context) {
	userID := c.GetString("user_id")

	hash := c.PostForm("hash")
	if !im.IsValidAttachmentHash(hash) {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	originalName := c.PostForm("original_name")

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	defer file.Close()

	if header.Size > h.service.MaxUploadSize() {
		Fail(c, errcode.AttachTooLarge)
		return
	}

	tmpFile, err := os.CreateTemp("", "."+hash+".*.tmp")
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	hasher := sha256.New()
	tee := io.TeeReader(file, hasher)
	written, err := io.Copy(tmpFile, tee)
	closeErr := tmpFile.Close()
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	if closeErr != nil {
		Fail(c, errcode.ErrInternal)
		return
	}

	computedHash := fmt.Sprintf("%x", hasher.Sum(nil))
	if computedHash != hash {
		Fail(c, errcode.AttachHashMismatch)
		return
	}

	// MIME sniff from the temp file before committing to storage.
	mimeType, err := sniffAttachmentMimeType(tmpPath)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	if !h.service.IsAttachmentMimeTypeAllowed(mimeType) {
		Fail(c, errcode.AttachTypeNotAllowed)
		return
	}
	metadata, err := service.ExtractImageMetadataJSON(tmpPath, mimeType)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}

	// Commit the blob to object storage (local or S3).
	// Re-open the temp file for reading.
	// #nosec G304 -- tmpPath is a server-generated temp file (os.CreateTemp)
	src, err := os.Open(tmpPath)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	defer src.Close()

	createdBlob, err := h.service.StoreBlob(c.Request.Context(), hash, src, mimeType)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}

	a, err := h.service.SaveAttachmentWithMetadata(c.Request.Context(), userID, hash, mimeType, originalName, written, metadata)
	if err != nil {
		if createdBlob {
			_ = h.service.DeleteBlob(c.Request.Context(), hash)
		}
		Fail(c, errcode.ErrInternal)
		return
	}

	OK(c, a)
}

func (h *AttachmentHandler) Download(c *gin.Context) {
	id := c.Param("id")

	userID := c.GetString("user_id")
	a, err := h.service.GetAttachmentByID(c.Request.Context(), userID, id)
	if err != nil {
		Fail(c, errcode.AttachNotFound)
		return
	}
	if !im.IsValidAttachmentHash(a.Hash) {
		Fail(c, errcode.AttachNotFound)
		return
	}

	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", formatAttachmentDisposition(a.OriginalName))

	// Fast path: local storage — serve the file directly.
	if localPath := h.service.BlobLocalPath(a.Hash); localPath != "" {
		if _, err := os.Stat(localPath); os.IsNotExist(err) {
			Fail(c, errcode.AttachNotFound)
			return
		}
		c.Header("Content-Type", safeAttachmentContentType(a.MimeType))
		c.File(localPath)
		return
	}

	// Remote storage: redirect to a presigned URL when available, then
	// fall back to Hub streaming for stores that cannot presign.
	presignedURL, err := h.service.PresignBlobURL(c.Request.Context(), a.Hash, safeAttachmentContentType(a.MimeType), formatAttachmentDisposition(a.OriginalName))
	if err == nil && presignedURL != "" {
		c.Redirect(http.StatusFound, presignedURL)
		return
	}

	reader, err := h.service.GetBlob(c.Request.Context(), a.Hash)
	if err != nil {
		Fail(c, errcode.AttachNotFound)
		return
	}
	defer reader.Close()

	c.DataFromReader(http.StatusOK, a.Size, safeAttachmentContentType(a.MimeType), reader, nil)
}

func sniffAttachmentMimeType(filePath string) (string, error) {
	// #nosec G304 -- only called with server-generated temp paths (os.CreateTemp)
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	var sample [512]byte
	n, err := file.Read(sample[:])
	if err != nil && err != io.EOF {
		return "", err
	}
	if n == 0 {
		return "application/octet-stream", nil
	}
	return http.DetectContentType(sample[:n]), nil
}

func safeAttachmentContentType(contentType string) string {
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType == "" {
		return "application/octet-stream"
	}
	return mime.FormatMediaType(mediaType, params)
}

func formatAttachmentDisposition(originalName string) string {
	filename := sanitizeAttachmentFilename(originalName)
	if filename == "" {
		filename = "download"
	}
	return mime.FormatMediaType("attachment", map[string]string{"filename": filename})
}

func sanitizeAttachmentFilename(originalName string) string {
	name := strings.ReplaceAll(originalName, "\\", "/")
	name = filepath.Base(name)
	name = strings.Map(func(r rune) rune {
		switch r {
		case '\r', '\n', 0:
			return -1
		default:
			return r
		}
	}, name)
	name = strings.TrimSpace(name)
	if name == "." || name == string(filepath.Separator) {
		return ""
	}
	return name
}
