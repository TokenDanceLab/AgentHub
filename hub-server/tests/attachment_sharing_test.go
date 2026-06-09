package tests

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
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

func TestAttachmentMetadataReadthroughAfterFileMessage(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "tattmeta_a", "pass1234", "AttachMetaA")
	bob := register(t, "tattmeta_b", "pass1234", "AttachMetaB")
	acceptFriendRequest(t, alice, bob)

	sessionResp := parse(postAuth("/client/sessions/private", alice.Token, map[string]string{"target_user_id": bob.ID}))
	mustOK(t, sessionResp, "create private session")
	sessionID := extract(sessionResp.Data, "session_id")

	content := makePNGAttachmentContent(t, 2, 3)
	hashBytes := sha256.Sum256(content)
	hash := fmt.Sprintf("%x", hashBytes)
	t.Cleanup(func() {
		_ = os.RemoveAll(filepath.Join("uploads", hash[:2], hash[2:4], hash))
	})

	attachmentID := uploadTestAttachment(t, alice.Token, hash, "metadata-chart.png", content)

	probeResp := parse(postAuth("/client/attachments/probe", alice.Token, map[string]string{"hash": hash}))
	mustOK(t, probeResp, "probe uploaded attachment")
	var probe struct {
		Exists     bool           `json:"exists"`
		Attachment testAttachment `json:"attachment"`
	}
	if err := json.Unmarshal(probeResp.Data, &probe); err != nil {
		t.Fatalf("decode probe response: %v", err)
	}
	if !probe.Exists {
		t.Fatalf("probe exists = false, want true")
	}
	assertAttachment(t, probe.Attachment, attachmentID, hash, int64(len(content)), "image/png", "metadata-chart.png", `{"height":3,"width":2}`)

	sendResp := parse(postAuth("/client/sessions/"+sessionID+"/messages", alice.Token, map[string]interface{}{
		"client_msg_id": "77777777-7777-4777-8777-777777777777",
		"content_type":  "file",
		"content":       fmt.Sprintf(`{"attachment_id":%q,"name":"metadata-chart.png"}`, attachmentID),
	}))
	mustOK(t, sendResp, "send file message")

	historyResp := parse(get("/client/sessions/"+sessionID+"/messages?limit=10", bob.Token))
	mustOK(t, historyResp, "get message history")
	var messages []struct {
		ClientMsgID string           `json:"client_msg_id"`
		ContentType string           `json:"content_type"`
		Attachments []testAttachment `json:"attachments"`
	}
	if err := json.Unmarshal(historyResp.Data, &messages); err != nil {
		t.Fatalf("decode message history: %v", err)
	}

	var fileMessage *struct {
		ClientMsgID string           `json:"client_msg_id"`
		ContentType string           `json:"content_type"`
		Attachments []testAttachment `json:"attachments"`
	}
	for i := range messages {
		if messages[i].ClientMsgID == "77777777-7777-4777-8777-777777777777" {
			fileMessage = &messages[i]
			break
		}
	}
	if fileMessage == nil {
		t.Fatalf("message history missing file message; got %d messages", len(messages))
	}
	if fileMessage.ContentType != "file" {
		t.Fatalf("history content_type = %q, want file", fileMessage.ContentType)
	}
	if len(fileMessage.Attachments) != 1 {
		t.Fatalf("history attachments len = %d, want 1", len(fileMessage.Attachments))
	}
	assertAttachment(t, fileMessage.Attachments[0], attachmentID, hash, int64(len(content)), "image/png", "metadata-chart.png", `{"height":3,"width":2}`)
}

type testAttachment struct {
	ID           string `json:"id"`
	Hash         string `json:"hash"`
	Size         int64  `json:"size"`
	MimeType     string `json:"mime_type"`
	OriginalName string `json:"original_name"`
	Metadata     string `json:"metadata"`
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

func acceptFriendRequest(t *testing.T, from, to testUser) {
	t.Helper()

	mustOK(t, parse(postAuth("/client/contacts/friend-requests", from.Token, map[string]interface{}{"friend_id": to.ID, "message": "Hi!"})), "send friend request")
	frListResp := parse(get("/client/contacts/friend-requests", to.Token))
	mustOK(t, frListResp, "list friend requests")
	var frList []map[string]interface{}
	if err := json.Unmarshal(frListResp.Data, &frList); err != nil {
		t.Fatalf("decode friend requests: %v", err)
	}
	if len(frList) == 0 {
		t.Fatal("expected at least one friend request")
	}
	reqID, ok := frList[0]["request_id"].(string)
	if !ok || reqID == "" {
		t.Fatalf("friend request missing request_id: %#v", frList[0])
	}
	mustOK(t, parse(postAuth("/client/contacts/friend-requests/"+reqID+"/accept", to.Token, nil)), "accept friend request")
}

func makePNGAttachmentContent(t *testing.T, width, height int) []byte {
	t.Helper()

	img := image.NewRGBA(image.Rect(0, 0, width, height))
	img.Set(width-1, height-1, color.RGBA{R: 255, A: 255})

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png attachment: %v", err)
	}
	return buf.Bytes()
}

func assertAttachment(t *testing.T, got testAttachment, id, hash string, size int64, mimeType, originalName, metadata string) {
	t.Helper()

	if got.ID != id {
		t.Fatalf("attachment id = %q, want %q", got.ID, id)
	}
	if got.Hash != hash {
		t.Fatalf("attachment hash = %q, want %q", got.Hash, hash)
	}
	if got.Size != size {
		t.Fatalf("attachment size = %d, want %d", got.Size, size)
	}
	if got.MimeType != mimeType {
		t.Fatalf("attachment mime_type = %q, want %q", got.MimeType, mimeType)
	}
	if got.OriginalName != originalName {
		t.Fatalf("attachment original_name = %q, want %q", got.OriginalName, originalName)
	}
	assertJSONEqual(t, got.Metadata, metadata, "attachment metadata")
}

func assertJSONEqual(t *testing.T, got, want, label string) {
	t.Helper()

	var gotJSON interface{}
	if err := json.Unmarshal([]byte(got), &gotJSON); err != nil {
		t.Fatalf("%s is not valid JSON: %q: %v", label, got, err)
	}
	var wantJSON interface{}
	if err := json.Unmarshal([]byte(want), &wantJSON); err != nil {
		t.Fatalf("test bug: wanted %s is not valid JSON: %q: %v", label, want, err)
	}
	gotNormalized, err := json.Marshal(gotJSON)
	if err != nil {
		t.Fatalf("normalize %s: %v", label, err)
	}
	wantNormalized, err := json.Marshal(wantJSON)
	if err != nil {
		t.Fatalf("normalize wanted %s: %v", label, err)
	}
	if !bytes.Equal(gotNormalized, wantNormalized) {
		t.Fatalf("%s = %s, want %s", label, gotNormalized, wantNormalized)
	}
}
