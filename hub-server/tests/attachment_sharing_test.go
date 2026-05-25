package tests

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestAttachmentDownloadAllowsSessionMemberAfterFileMessage(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "tattshare_a", "pass1234", "AttachShareA")
	bob := register(t, "tattshare_b", "pass1234", "AttachShareB")
	if err := clearRateLimitKeys(); err != nil {
		t.Fatalf("clear rate limits before outsider register: %v", err)
	}
	outsider := register(t, "tattshare_c", "pass1234", "AttachShareC")

	sessionResp := parse(postAuth("/client/sessions/private", alice.Token, map[string]string{"target_user_id": bob.ID}))
	mustOK(t, sessionResp, "create private session")
	sessionID := extract(sessionResp.Data, "session_id")

	content := []byte("shared attachment content for message reference")
	hashBytes := sha256.Sum256(content)
	hash := fmt.Sprintf("%x", hashBytes)
	t.Cleanup(func() {
		_ = os.RemoveAll(filepath.Join("uploads", hash[:2], hash[2:4], hash))
	})

	attachmentID := uploadTestAttachment(t, alice.Token, hash, "shared.txt", content)

	sendResp := parse(postAuth("/client/sessions/"+sessionID+"/messages", alice.Token, map[string]interface{}{
		"client_msg_id": "66666666-6666-4666-8666-666666666666",
		"content_type":  "file",
		"content":       fmt.Sprintf(`{"attachment_id":%q,"name":"shared.txt"}`, attachmentID),
	}))
	mustOK(t, sendResp, "send file message")

	bobDownload := get("/client/attachments/"+attachmentID, bob.Token)
	defer bobDownload.Body.Close()
	if bobDownload.StatusCode != http.StatusOK {
		t.Fatalf("session member download status = %d, want 200", bobDownload.StatusCode)
	}
	got, err := io.ReadAll(bobDownload.Body)
	if err != nil {
		t.Fatalf("read session member download body: %v", err)
	}
	if !bytes.Equal(got, content) {
		t.Fatalf("session member download body = %q, want %q", got, content)
	}

	outsiderResp := parse(get("/client/attachments/"+attachmentID, outsider.Token))
	mustCode(t, outsiderResp, "ATTACH_NOT_FOUND", "outsider cannot download referenced attachment")
}

func uploadTestAttachment(t *testing.T, token, hash, originalName string, content []byte) string {
	t.Helper()

	body := new(bytes.Buffer)
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("hash", hash); err != nil {
		t.Fatalf("write hash field: %v", err)
	}
	if err := writer.WriteField("original_name", originalName); err != nil {
		t.Fatalf("write original_name field: %v", err)
	}
	part, err := writer.CreateFormFile("file", originalName)
	if err != nil {
		t.Fatalf("create file field: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write file field: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/client/attachments", body)
	if err != nil {
		t.Fatalf("create upload request: %v", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("upload attachment request: %v", err)
	}
	r := parse(resp)
	mustOK(t, r, "upload attachment")

	var payload struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(r.Data, &payload); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}
	if payload.ID == "" {
		t.Fatalf("upload response missing attachment id: %s", string(r.Data))
	}
	return payload.ID
}
