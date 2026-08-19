package document

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// Service provides CRUD and artifact-projection document operations.
type Service struct {
	db *gorm.DB
}

// NewService creates a new Service.
func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

// CreateDocument creates a new user-owned document.
func (s *Service) CreateDocument(ctx context.Context, userID, title, docType, location string, tag *string, content *string) (*model.Document, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, errcode.ErrBadRequest.WithMessage("title is required")
	}
	docType = strings.TrimSpace(docType)
	if docType == "" {
		docType = "md"
	}
	location = strings.TrimSpace(location)
	if location == "" {
		location = "我的文档库"
	}

	doc := &model.Document{
		OwnerID:  userID,
		Title:    title,
		Type:     docType,
		Source:   model.DocumentSourceUser,
		Tag:      tag,
		Location: location,
		Content:  content,
		Status:   model.DocumentStatusActive,
	}
	if err := repository.CreateDocument(s.db, doc); err != nil {
		return nil, err
	}
	return doc, nil
}

// GetDocument returns a single document by ID, checking ownership.
func (s *Service) GetDocument(ctx context.Context, userID, docID string) (*model.Document, error) {
	doc, err := repository.GetDocumentByID(s.db, docID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.DocNotFound
		}
		return nil, err
	}
	if doc.OwnerID != userID {
		return nil, errcode.DocNotFound
	}
	if doc.Status == model.DocumentStatusDeleted {
		return nil, errcode.DocNotFound
	}
	return doc, nil
}

// UpdateDocument patches a document owned by the user.
func (s *Service) UpdateDocument(ctx context.Context, userID, docID string, title, docType *string, tag *string, content *string) (*model.Document, error) {
	doc, err := s.GetDocument(ctx, userID, docID)
	if err != nil {
		return nil, err
	}
	patch := map[string]interface{}{}
	if title != nil {
		t := strings.TrimSpace(*title)
		if t == "" {
			return nil, errcode.ErrBadRequest.WithMessage("title must not be empty")
		}
		patch["title"] = t
	}
	if docType != nil {
		patch["type"] = strings.TrimSpace(*docType)
	}
	if tag != nil {
		patch["tag"] = *tag
	}
	if content != nil {
		patch["content"] = *content
	}
	if len(patch) == 0 {
		return doc, nil
	}
	patch["updated_at"] = time.Now()
	if err := repository.UpdateDocument(s.db, docID, patch); err != nil {
		return nil, err
	}
	return repository.GetDocumentByID(s.db, docID)
}

// DeleteDocument soft-deletes a document owned by the user.
func (s *Service) DeleteDocument(ctx context.Context, userID, docID string) error {
	doc, err := s.GetDocument(ctx, userID, docID)
	if err != nil {
		return err
	}
	if doc.Status == model.DocumentStatusDeleted {
		return errcode.DocAlreadyDeleted
	}
	return repository.SoftDeleteDocument(s.db, docID)
}

// ListDocuments returns a merged list of user-created documents and
// artifact documents projected from agent run file_change events.
func (s *Service) ListDocuments(ctx context.Context, userID string, filter model.DocumentFilter) ([]model.DocumentListItem, error) {
	// Clamp limit.
	if filter.Limit <= 0 {
		filter.Limit = 50
	}
	if filter.Limit > 200 {
		filter.Limit = 200
	}

	// 1. Fetch user-owned documents from the documents table.
	docs, err := repository.ListDocumentsByOwner(s.db, userID, filter)
	if err != nil {
		return nil, err
	}
	items := make([]model.DocumentListItem, 0, len(docs))
	for i := range docs {
		items = append(items, docs[i].ToListItem())
	}

	// 2. Project artifact documents from agent_run_events (file_change).
	// Only include artifact source if the filter allows it.
	if filter.Source == "" || filter.Source == model.DocumentSourceArtifact {
		artifactItems, aErr := s.projectArtifactDocuments(ctx, userID, filter)
		if aErr != nil {
			_ = aErr // Artifact projection errors are non-fatal; user docs still returned.
		} else {
			items = append(items, artifactItems...)
		}
	}

	// 3. Sort merged items by created_at DESC.
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})

	// 4. Apply limit to merged result.
	if len(items) > filter.Limit {
		items = items[:filter.Limit]
	}

	return items, nil
}

// projectArtifactDocuments queries agent_run_events for file_change events
// belonging to tasks triggered by this user, and maps them to DocumentListItem.
func (s *Service) projectArtifactDocuments(ctx context.Context, userID string, filter model.DocumentFilter) ([]model.DocumentListItem, error) {
	var events []model.AgentRunEvent
	q := s.db.Model(&model.AgentRunEvent{}).
		Joins("JOIN pending_agent_tasks pat ON pat.id = agent_run_events.task_id").
		Where("pat.triggered_by_user_id = ?", userID).
		Where("agent_run_events.event_type = ?", "run.agent.file_change").
		Where("pat.status IN ?", []string{model.TaskStatusDone, model.TaskStatusDispatched, model.TaskStatusRunning}).
		Where("(agent_run_events.payload->>'path') NOT LIKE ?", ".fingerprint/%")

	if filter.After != "" {
		q = q.Where("agent_run_events.created_at < ?", filter.After)
	}

	// Get distinct latest file_change events per (task_id, path).
	// DISTINCT ON is PostgreSQL-specific.
	q = q.Select("DISTINCT ON (agent_run_events.task_id, (agent_run_events.payload->>'path')) agent_run_events.*").
		Order("agent_run_events.task_id, (agent_run_events.payload->>'path'), agent_run_events.created_at DESC")

	if err := q.Limit(100).Find(&events).Error; err != nil {
		return nil, err
	}

	items := make([]model.DocumentListItem, 0, len(events))
	for _, evt := range events {
		items = append(items, artifactEventToDocItem(evt))
	}
	return items, nil
}

// artifactEventToDocItem maps a single file_change AgentRunEvent to a DocumentListItem.
func artifactEventToDocItem(evt model.AgentRunEvent) model.DocumentListItem {
	payload := map[string]interface{}{}
	_ = json.Unmarshal([]byte(evt.Payload), &payload)

	path, _ := payload["path"].(string)
	if path == "" {
		path = "unknown"
	}

	docType := fileTypeFromPath(path)
	location := "项目产物"

	var tag *string
	if action, ok := payload["action"].(string); ok {
		switch action {
		case "created":
			t := "新增"
			tag = &t
		case "modified":
			t := "修改"
			tag = &t
		case "deleted":
			t := "删除"
			tag = &t
		}
	}

	sourceRef := evt.TaskID

	return model.DocumentListItem{
		ID:        evt.ID,
		OwnerID:   "",
		Title:     path,
		Type:      docType,
		Source:    model.DocumentSourceArtifact,
		SourceRef: &sourceRef,
		Tag:       tag,
		Location:  location,
		Status:    model.DocumentStatusActive,
		CreatedAt: evt.CreatedAt,
		UpdatedAt: evt.CreatedAt,
	}
}

// fileTypeFromPath maps a file extension to a document type label.
func fileTypeFromPath(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".mdx"):
		return "md"
	case strings.HasSuffix(lower, ".ts") || strings.HasSuffix(lower, ".tsx"):
		return "ts"
	case strings.HasSuffix(lower, ".js") || strings.HasSuffix(lower, ".jsx"):
		return "js"
	case strings.HasSuffix(lower, ".css"):
		return "css"
	case strings.HasSuffix(lower, ".html"):
		return "html"
	case strings.HasSuffix(lower, ".sql") || strings.HasSuffix(lower, ".db"):
		return "db"
	case strings.HasSuffix(lower, ".xlsx") || strings.HasSuffix(lower, ".xls"):
		return "xlsx"
	case strings.HasSuffix(lower, ".go"):
		return "go"
	case strings.HasSuffix(lower, ".py"):
		return "py"
	case strings.HasSuffix(lower, ".rs"):
		return "rs"
	case strings.HasSuffix(lower, ".json") || strings.HasSuffix(lower, ".yaml") || strings.HasSuffix(lower, ".yml"):
		return "txt"
	default:
		return "txt"
	}
}
