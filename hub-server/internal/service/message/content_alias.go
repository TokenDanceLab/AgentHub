package message

import "github.com/agenthub/hub-server/internal/service/im"

// ── Pure IM helpers (aliases to service/im; #628/#639) ───────────────────────
// Content-type allowlist source of truth is im.IsValidContentType.

// normalizeMessageContent is a thin alias to im.NormalizeMessageContent.
func normalizeMessageContent(contentType, content string) (string, error) {
	return im.NormalizeMessageContent(contentType, content)
}

// attachmentIDsFromContent is a thin alias to im.AttachmentIDsFromContent.
func attachmentIDsFromContent(contentType, content string) ([]string, bool) {
	return im.AttachmentIDsFromContent(contentType, content)
}
