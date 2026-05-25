package handler

import (
	"context"
	"crypto/sha256"
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
)

// AttachmentService is the subset of *service.AttachmentService used by AttachmentHandler.
type AttachmentService interface {
	ProbeAttachment(ctx context.Context, userID, hash string) (*model.Attachment, error)
	SaveAttachment(ctx context.Context, uploaderID, hash, mimeType, originalName string, size int64) (*model.Attachment, error)
	GetAttachmentByID(ctx context.Context, userID, id string) (*model.Attachment, error)
	MaxUploadSize() int64
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
	if !service.IsValidAttachmentHash(req.Hash) {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	userID := c.GetString("user_id")
	a, err := h.service.ProbeAttachment(c.Request.Context(), userID, req.Hash)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
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
	if !service.IsValidAttachmentHash(hash) {
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

	relPath := service.PathFromHash(hash)
	absDir := filepath.Join(".", relPath)
	if err := os.MkdirAll(absDir, 0755); err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	filePath := filepath.Join(absDir, hash)

	tmpFile, err := os.CreateTemp(absDir, "."+hash+".*.tmp")
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

	createdBlob, err := commitAttachmentBlob(tmpPath, filePath)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}

	mimeType, err := sniffAttachmentMimeType(tmpPath)
	if err != nil {
		if createdBlob {
			_ = os.Remove(filePath)
		}
		Fail(c, errcode.ErrInternal)
		return
	}

	a, err := h.service.SaveAttachment(c.Request.Context(), userID, hash, mimeType, originalName, written)
	if err != nil {
		if createdBlob {
			_ = os.Remove(filePath)
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
	if !service.IsValidAttachmentHash(a.Hash) {
		Fail(c, errcode.AttachNotFound)
		return
	}

	relPath := service.PathFromHash(a.Hash)
	if relPath == "" {
		Fail(c, errcode.AttachNotFound)
		return
	}
	absPath := filepath.Join(".", relPath, a.Hash)
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		Fail(c, errcode.AttachNotFound)
		return
	}

	c.Header("Content-Type", safeAttachmentContentType(a.MimeType))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", formatAttachmentDisposition(a.OriginalName))
	c.File(absPath)
}

func commitAttachmentBlob(tmpPath, filePath string) (bool, error) {
	dst, err := os.OpenFile(filePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		if os.IsExist(err) {
			return false, nil
		}
		return false, err
	}

	keepDestination := false
	defer func() {
		if !keepDestination {
			_ = os.Remove(filePath)
		}
	}()

	src, err := os.Open(tmpPath)
	if err != nil {
		_ = dst.Close()
		return true, err
	}

	_, copyErr := io.Copy(dst, src)
	closeSrcErr := src.Close()
	closeDstErr := dst.Close()
	if copyErr != nil {
		return true, copyErr
	}
	if closeSrcErr != nil {
		return true, closeSrcErr
	}
	if closeDstErr != nil {
		return true, closeDstErr
	}

	keepDestination = true
	return true, nil
}

func sniffAttachmentMimeType(filePath string) (string, error) {
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
