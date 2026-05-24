package handler

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

// AttachmentService is the subset of *service.AttachmentService used by AttachmentHandler.
type AttachmentService interface {
	ProbeAttachment(ctx context.Context, hash string) (*model.Attachment, error)
	SaveAttachment(ctx context.Context, uploaderID, hash, mimeType, originalName string, size int64) (*model.Attachment, error)
	GetAttachmentByID(ctx context.Context, id string) (*model.Attachment, error)
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

	a, err := h.service.ProbeAttachment(c.Request.Context(), req.Hash)
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

	dst, err := os.Create(filePath)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	defer dst.Close()

	hasher := sha256.New()
	tee := io.TeeReader(file, hasher)
	written, err := io.Copy(dst, tee)
	if err != nil {
		os.Remove(filePath)
		Fail(c, errcode.ErrInternal)
		return
	}

	computedHash := fmt.Sprintf("%x", hasher.Sum(nil))
	if computedHash != hash {
		os.Remove(filePath)
		Fail(c, errcode.AttachHashMismatch)
		return
	}

	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	a, err := h.service.SaveAttachment(c.Request.Context(), userID, hash, mimeType, originalName, written)
	if err != nil {
		os.Remove(filePath)
		Fail(c, errcode.ErrInternal)
		return
	}

	OK(c, a)
}

func (h *AttachmentHandler) Download(c *gin.Context) {
	id := c.Param("id")

	a, err := h.service.GetAttachmentByID(c.Request.Context(), id)
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

	c.Header("Content-Type", a.MimeType)
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, a.OriginalName))
	c.File(absPath)
}
