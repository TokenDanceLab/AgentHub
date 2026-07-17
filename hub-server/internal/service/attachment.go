package service

import (
	"github.com/agenthub/hub-server/internal/service/im"
)

// NormalizeAttachmentMetadataJSON is a thin alias to im.NormalizeAttachmentMetadataJSON.
// Exported for handler/test call sites that already import service.
func NormalizeAttachmentMetadataJSON(metadata string) (string, error) {
	return im.NormalizeAttachmentMetadataJSON(metadata)
}

// IsValidAttachmentHash is a thin alias to im.IsValidAttachmentHash.
// Exported for handler/test call sites that already import service.
func IsValidAttachmentHash(hash string) bool {
	return im.IsValidAttachmentHash(hash)
}

// PathFromHash is a thin alias to im.PathFromHash.
// Exported for handler/test call sites that already import service.
func PathFromHash(hash string) string {
	return im.PathFromHash(hash)
}
