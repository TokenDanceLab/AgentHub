package workspace

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/im"
	"github.com/agenthub/hub-server/internal/uuidv7"
)

// WorkspaceListResult holds paginated Hub project/workspace results.
// JSON field names are contract-stable (OpenAPI list envelope).
type WorkspaceListResult struct {
	Items   []model.Workspace `json:"items"`
	HasMore bool              `json:"has_more"`
	Cursor  string            `json:"next_cursor,omitempty"`
}

// WorkspaceUpdate carries PATCH semantics: nil fields are not changed.
type WorkspaceUpdate struct {
	Name        *string
	Description *string
}

// WorkspaceThread is the Web project-facing projection of a Hub group session.
// JSON field names are contract-stable for /web/projects thread routes.
type WorkspaceThread struct {
	ID            string     `json:"id"`
	ProjectID     string     `json:"project_id"`
	Type          string     `json:"type"`
	Name          string     `json:"name"`
	OwnerUserID   string     `json:"owner_user_id,omitempty"`
	Role          string     `json:"role,omitempty"`
	MemberCount   int64      `json:"member_count"`
	LastMessageAt *time.Time `json:"last_message_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// CreateWorkspaceThreadRequest is the create-thread body for Web project threads.
type CreateWorkspaceThreadRequest struct {
	Name string `json:"name"`
}

// SendWorkspaceThreadMessageRequest is the send-message body for Web project threads.
type SendWorkspaceThreadMessageRequest struct {
	ClientMsgID string `json:"client_msg_id"`
	ContentType string `json:"content_type"`
	Content     string `json:"content"`
}

// WorkspaceThreadMessage is the Web project-facing projection of a Hub message.
// JSON field names are contract-stable for /web/projects thread message routes.
type WorkspaceThreadMessage struct {
	ID          string    `json:"id"`
	ProjectID   string    `json:"project_id"`
	ThreadID    string    `json:"thread_id"`
	SeqID       int64     `json:"seq_id"`
	ClientMsgID string    `json:"client_msg_id"`
	SenderType  string    `json:"sender_type"`
	SenderID    string    `json:"sender_id"`
	ContentType string    `json:"content_type"`
	Content     string    `json:"content"`
	CreatedAt   time.Time `json:"created_at"`
}

// Service exposes Web-owned project CRUD backed by Hub workspaces.
// DB-only (no bus/cache ports — none exist). Pure thread-message content +
// name/description normalize helpers remain in service/im (#628/#639/#651);
// this package is the second IM typed-service extract (#673) after
// messagereaction (#662).
type Service struct {
	db *gorm.DB
}

// NewService constructs a workspace service.
func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

func (s *Service) Create(ctx context.Context, ownerID string, req *model.Workspace) (*model.Workspace, error) {
	name, err := normalizeWorkspaceName(req.Name)
	if err != nil {
		return nil, errcode.ErrBadRequest.WithMessage("workspace name is required")
	}

	existing, err := repository.FindWorkspaceByOwnerAndName(s.db, ownerID, name)
	if err == nil && existing != nil {
		return nil, errcode.UserInvalidParam.WithMessage("workspace name already exists")
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	req.ID = ""
	req.OwnerID = ownerID
	req.Name = name
	req.Description = normalizeWorkspaceDescription(req.Description)
	if err := repository.CreateWorkspace(s.db, req); err != nil {
		return nil, err
	}
	return req, nil
}

func (s *Service) Get(ctx context.Context, id, ownerID string) (*model.Workspace, error) {
	workspace, err := repository.GetWorkspaceByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	if workspace.OwnerID != ownerID {
		return nil, errcode.AuthDeviceMismatch
	}
	return workspace, nil
}

func (s *Service) Update(ctx context.Context, id, ownerID string, req *WorkspaceUpdate) (*model.Workspace, error) {
	workspace, err := repository.GetWorkspaceByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.UserNotFound
		}
		return nil, err
	}
	if workspace.OwnerID != ownerID {
		return nil, errcode.AuthDeviceMismatch
	}

	if req.Name != nil {
		name, err := normalizeWorkspaceName(*req.Name)
		if err != nil {
			return nil, errcode.ErrBadRequest.WithMessage("workspace name is required")
		}
		if name != workspace.Name {
			existing, err := repository.FindWorkspaceByOwnerAndName(s.db, ownerID, name)
			if err == nil && existing != nil && existing.ID != workspace.ID {
				return nil, errcode.UserInvalidParam.WithMessage("workspace name already exists")
			}
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, err
			}
		}
		workspace.Name = name
	}
	if req.Description != nil {
		workspace.Description = normalizeWorkspaceDescription(*req.Description)
	}

	if err := repository.UpdateWorkspace(s.db, workspace); err != nil {
		return nil, err
	}
	return workspace, nil
}

func (s *Service) List(ctx context.Context, ownerID, q, cursor string, pageSize int) (*WorkspaceListResult, error) {
	workspaces, hasMore, err := repository.ListWorkspaces(s.db, ownerID, normalizeWorkspaceDescription(q), cursor, pageSize)
	if err != nil {
		return nil, err
	}
	nextCursor := ""
	if hasMore && len(workspaces) > 0 {
		nextCursor = workspaces[len(workspaces)-1].ID
	}
	return &WorkspaceListResult{Items: workspaces, HasMore: hasMore, Cursor: nextCursor}, nil
}

func (s *Service) ListThreads(ctx context.Context, projectID, ownerID string) ([]WorkspaceThread, error) {
	if _, err := s.Get(ctx, projectID, ownerID); err != nil {
		return nil, err
	}
	sessions, err := repository.ListWorkspaceSessions(s.db, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	threads := make([]WorkspaceThread, 0, len(sessions))
	for _, session := range sessions {
		threads = append(threads, workspaceThreadFromSession(session, projectID))
	}
	return threads, nil
}

func (s *Service) CreateThread(ctx context.Context, projectID, ownerID string, req *CreateWorkspaceThreadRequest) (*WorkspaceThread, error) {
	if _, err := s.Get(ctx, projectID, ownerID); err != nil {
		return nil, err
	}
	name, err := normalizeWorkspaceName(req.Name)
	if err != nil {
		return nil, errcode.ErrBadRequest.WithMessage("thread name is required")
	}

	session := &model.Session{
		Type:        model.SessionTypeGroup,
		Name:        name,
		OwnerUserID: &ownerID,
		WorkspaceID: &projectID,
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.CreateSession(tx, session); err != nil {
			return err
		}
		return repository.BatchCreateMembers(tx, []*model.SessionMember{{
			SessionID:  session.ID,
			MemberType: model.MemberTypeUser,
			MemberID:   ownerID,
			Role:       model.MemberRoleOwner,
		}})
	})
	if err != nil {
		return nil, err
	}
	return &WorkspaceThread{
		ID:          session.ID,
		ProjectID:   projectID,
		Type:        session.Type,
		Name:        session.Name,
		OwnerUserID: ownerID,
		Role:        model.MemberRoleOwner,
		MemberCount: 1,
		CreatedAt:   session.CreatedAt,
	}, nil
}

func (s *Service) CreateThreadMessage(ctx context.Context, projectID, threadID, ownerID string, req SendWorkspaceThreadMessageRequest) (*WorkspaceThreadMessage, error) {
	session, err := s.requireProjectThread(ctx, projectID, threadID, ownerID)
	if err != nil {
		return nil, err
	}
	contentType := strings.TrimSpace(req.ContentType)
	if contentType == "" {
		contentType = model.ContentTypeText
	}
	if !im.IsValidContentType(contentType) {
		return nil, errcode.ErrBadRequest
	}
	content, err := normalizeWorkspaceThreadMessageContent(contentType, req.Content)
	if err != nil {
		return nil, errcode.ErrBadRequest
	}
	clientMsgID := strings.TrimSpace(req.ClientMsgID)
	if clientMsgID == "" {
		clientMsgID = uuidv7.Must()
	}

	msg := &model.Message{
		SessionID:   threadID,
		ClientMsgID: clientMsgID,
		SenderType:  model.SenderTypeUser,
		SenderID:    ownerID,
		ContentType: contentType,
		Content:     content,
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var current model.Session
		if err := tx.Where("id = ?", threadID).First(&current).Error; err != nil {
			return err
		}
		msg.SeqID = current.NextSeq + 1
		if err := repository.InsertMessage(tx, msg); err != nil {
			return err
		}
		return tx.Model(&model.Session{}).Where("id = ?", threadID).Updates(map[string]any{
			"next_seq":        msg.SeqID,
			"last_message_at": time.Now(),
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return workspaceThreadMessageFromModel(*msg, projectID, session.ID), nil
}

func (s *Service) ListThreadMessages(ctx context.Context, projectID, threadID, ownerID string, limit int) ([]WorkspaceThreadMessage, error) {
	session, err := s.requireProjectThread(ctx, projectID, threadID, ownerID)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	msgs, err := repository.GetMessagesBySession(s.db, threadID, 0, limit)
	if err != nil {
		return nil, err
	}
	result := make([]WorkspaceThreadMessage, 0, len(msgs))
	for _, msg := range msgs {
		result = append(result, *workspaceThreadMessageFromModel(msg, projectID, session.ID))
	}
	return result, nil
}

func (s *Service) requireProjectThread(ctx context.Context, projectID, threadID, ownerID string) (*model.Session, error) {
	if _, err := s.Get(ctx, projectID, ownerID); err != nil {
		return nil, err
	}
	session, err := repository.GetSessionByID(s.db, threadID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.SessionNotFound
		}
		return nil, err
	}
	if session.WorkspaceID == nil || *session.WorkspaceID != projectID || session.Dissolved {
		return nil, errcode.SessionNotFound
	}
	active, err := repository.IsMemberActive(s.db, threadID, model.MemberTypeUser, ownerID)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, errcode.SessionNotMember
	}
	return session, nil
}

func workspaceThreadFromSession(session repository.SessionWithMeta, projectID string) WorkspaceThread {
	ownerID := ""
	if session.OwnerUserID != nil {
		ownerID = *session.OwnerUserID
	}
	return WorkspaceThread{
		ID:            session.ID,
		ProjectID:     projectID,
		Type:          session.Type,
		Name:          session.Name,
		OwnerUserID:   ownerID,
		Role:          session.Role,
		MemberCount:   session.MemberCount,
		LastMessageAt: session.LastMessageAt,
		CreatedAt:     session.CreatedAt,
	}
}

func workspaceThreadMessageFromModel(msg model.Message, projectID, threadID string) *WorkspaceThreadMessage {
	return &WorkspaceThreadMessage{
		ID:          msg.ID,
		ProjectID:   projectID,
		ThreadID:    threadID,
		SeqID:       msg.SeqID,
		ClientMsgID: msg.ClientMsgID,
		SenderType:  msg.SenderType,
		SenderID:    msg.SenderID,
		ContentType: msg.ContentType,
		Content:     msg.Content,
		CreatedAt:   msg.CreatedAt,
	}
}

// normalizeWorkspaceThreadMessageContent is a thin alias to
// im.NormalizeWorkspaceThreadMessageContent.
func normalizeWorkspaceThreadMessageContent(contentType, content string) (string, error) {
	return im.NormalizeWorkspaceThreadMessageContent(contentType, content)
}

// normalizeWorkspaceName is a thin alias to im.NormalizeRequiredName.
func normalizeWorkspaceName(name string) (string, error) {
	return im.NormalizeRequiredName(name)
}

// normalizeWorkspaceDescription is a thin alias to im.NormalizeOptionalText.
func normalizeWorkspaceDescription(text string) string {
	return im.NormalizeOptionalText(text)
}
