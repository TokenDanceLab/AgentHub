package service

import (
	"context"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

func TestPathFromHashValidatesHashShape(t *testing.T) {
	validHash := strings.Repeat("a", 64)
	if got, want := PathFromHash(validHash), "uploads/aa/aa/"+validHash; got != want {
		t.Fatalf("PathFromHash valid hash = %q, want %q", got, want)
	}

	for _, hash := range []string{
		"",
		"abc",
		strings.Repeat("g", 64),
		strings.Repeat("A", 64),
	} {
		t.Run(hash, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("PathFromHash(%q) panicked: %v", hash, r)
				}
			}()
			if got := PathFromHash(hash); got != "" {
				t.Fatalf("PathFromHash(%q) = %q, want empty path", hash, got)
			}
		})
	}
}

func TestProbeAttachmentHidesOtherUsersAttachment(t *testing.T) {
	db := newAttachmentTestDB(t)
	svc := NewAttachmentService(db, config.UploadConfig{MaxSize: 1024})
	ctx := context.Background()
	hash := strings.Repeat("1", 64)

	ownerAttachment, err := svc.SaveAttachment(ctx, "owner-1", hash, "text/plain", "owner.txt", 12)
	if err != nil {
		t.Fatalf("SaveAttachment returned error: %v", err)
	}

	otherUserAttachment, err := svc.ProbeAttachment(ctx, "other-user", hash)
	if err != nil {
		t.Fatalf("ProbeAttachment for other user returned error: %v", err)
	}
	if otherUserAttachment != nil {
		t.Fatalf("ProbeAttachment returned another user's attachment: %#v", otherUserAttachment)
	}

	ownerProbe, err := svc.ProbeAttachment(ctx, "owner-1", hash)
	if err != nil {
		t.Fatalf("ProbeAttachment for owner returned error: %v", err)
	}
	if ownerProbe == nil || ownerProbe.ID != ownerAttachment.ID {
		t.Fatalf("ProbeAttachment for owner = %#v, want attachment %s", ownerProbe, ownerAttachment.ID)
	}
}

func TestGetAttachmentByIDRejectsOtherUsersAttachment(t *testing.T) {
	db := newAttachmentAccessTestDB(t)
	svc := NewAttachmentService(db, config.UploadConfig{MaxSize: 1024})
	ctx := context.Background()

	ownerAttachment, err := svc.SaveAttachment(ctx, "owner-1", strings.Repeat("2", 64), "text/plain", "owner.txt", 12)
	if err != nil {
		t.Fatalf("SaveAttachment returned error: %v", err)
	}

	if _, err := svc.GetAttachmentByID(ctx, "other-user", ownerAttachment.ID); err != errcode.AttachNotFound {
		t.Fatalf("GetAttachmentByID for other user error = %v, want AttachNotFound", err)
	}

	got, err := svc.GetAttachmentByID(ctx, "owner-1", ownerAttachment.ID)
	if err != nil {
		t.Fatalf("GetAttachmentByID for owner returned error: %v", err)
	}
	if got.ID != ownerAttachment.ID {
		t.Fatalf("GetAttachmentByID for owner returned %s, want %s", got.ID, ownerAttachment.ID)
	}
}

func TestGetAttachmentByIDAllowsSessionMemberForReferencedAttachment(t *testing.T) {
	db := newAttachmentAccessTestDB(t)
	svc := NewAttachmentService(db, config.UploadConfig{MaxSize: 1024})
	ctx := context.Background()

	ownerAttachment, err := svc.SaveAttachment(ctx, "owner-1", strings.Repeat("3", 64), "text/plain", "shared.txt", 12)
	if err != nil {
		t.Fatalf("SaveAttachment returned error: %v", err)
	}
	if err := db.Exec(`INSERT INTO session_members (id, session_id, member_type, member_id, role) VALUES
		('mem-owner', 'sess-shared', 'user', 'owner-1', 'member'),
		('mem-viewer', 'sess-shared', 'user', 'viewer-1', 'member')`).Error; err != nil {
		t.Fatalf("insert session members: %v", err)
	}
	if err := db.Exec(`INSERT INTO message_attachments (session_id, message_id, attachment_id) VALUES (?, ?, ?)`,
		"sess-shared", "msg-shared", ownerAttachment.ID).Error; err != nil {
		t.Fatalf("insert message attachment reference: %v", err)
	}

	got, err := svc.GetAttachmentByID(ctx, "viewer-1", ownerAttachment.ID)
	if err != nil {
		t.Fatalf("GetAttachmentByID for session member returned error: %v", err)
	}
	if got.ID != ownerAttachment.ID {
		t.Fatalf("GetAttachmentByID for session member returned %s, want %s", got.ID, ownerAttachment.ID)
	}

	if _, err := svc.GetAttachmentByID(ctx, "outsider-1", ownerAttachment.ID); err != errcode.AttachNotFound {
		t.Fatalf("GetAttachmentByID for outsider error = %v, want AttachNotFound", err)
	}
}

func newAttachmentTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Attachment{}); err != nil {
		t.Fatalf("AutoMigrate attachment: %v", err)
	}
	return db
}

func newAttachmentAccessTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := newAttachmentTestDB(t)
	if err := db.Exec(`CREATE TABLE session_members (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		member_type TEXT NOT NULL,
		member_id TEXT NOT NULL,
		role TEXT NOT NULL,
		left_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create session_members: %v", err)
	}
	if err := db.Exec(`CREATE TABLE message_attachments (
		session_id TEXT NOT NULL,
		message_id TEXT NOT NULL,
		attachment_id TEXT NOT NULL,
		created_at DATETIME,
		PRIMARY KEY (message_id, attachment_id)
	)`).Error; err != nil {
		t.Fatalf("create message_attachments: %v", err)
	}
	return db
}
