package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/store"
)

// Handler holds dependencies for HTTP and WebSocket handlers.
func (h *Handler) GetProjects(w http.ResponseWriter, r *http.Request) {
	repo := ensureStore(h)
	userID := h.ownerUserID(r)
	writeSuccess(w, http.StatusOK, listResponse(filterProjectsByOwner(repo.ListProjects(), userID)))
}

func (h *Handler) PostProjects(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectID string `json:"projectId"`
		Name      string `json:"name"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		errcode.Write(w, errcode.ErrInvalidJSON)
		return
	}
	if req.ProjectID == "" {
		req.ProjectID = genID("proj_")
	}
	// When authenticated via Hub JWT, set the Hub user as the project owner.
	ownerID := hubUserFromRequest(r)
	project, err := ensureStore(h).CreateProject(req.ProjectID, req.Name, ownerID)
	if errors.Is(err, store.ErrProjectExists) {
		writeSuccess(w, http.StatusOK, project)
		return
	}
	h.Bus.Publish("project.created", map[string]any{"projectId": project.ID}, project)
	writeSuccess(w, http.StatusCreated, project)
}

func (h *Handler) GetProject(w http.ResponseWriter, r *http.Request) {
	projectID := strings.TrimPrefix(r.URL.Path, "/v1/projects/")
	repo := ensureStore(h)
	userID := h.ownerUserID(r)
	if project, ok := repo.GetProject(projectID); ok {
		if !isProjectOwnedBy(repo, project.ID, userID) {
			errcode.Write(w, errcode.ErrNotFound.WithMessage("project not found"))
			return
		}
		writeSuccess(w, http.StatusOK, project)
		return
	}
	errcode.Write(w, errcode.ErrNotFound.WithMessage("project not found"))
}

func (h *Handler) GetThreads(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("projectId")
	repo := ensureStore(h)
	userID := h.ownerUserID(r)
	writeSuccess(w, http.StatusOK, listResponse(filterThreadsByOwner(repo.ListThreads(projectID), repo, userID)))
}

func (h *Handler) PostThreads(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ThreadID  string `json:"threadId"`
		ProjectID string `json:"projectId"`
		Title     string `json:"title"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		errcode.Write(w, errcode.ErrInvalidJSON)
		return
	}
	if req.ProjectID == "" {
		req.ProjectID = "proj_local"
	}
	if req.ThreadID == "" {
		req.ThreadID = genID("thread_")
	}
	thread, err := ensureStore(h).CreateThread(req.ThreadID, req.ProjectID, req.Title, "", "", "")
	if err != nil {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("project not found"))
		return
	}
	h.Bus.Publish("thread.created", map[string]any{
		"projectId": thread.ProjectID,
		"threadId":  thread.ID,
	}, thread)
	writeSuccess(w, http.StatusCreated, thread)
}

func (h *Handler) GetThread(w http.ResponseWriter, r *http.Request) {
	threadID := strings.TrimPrefix(r.URL.Path, "/v1/threads/")
	repo := ensureStore(h)
	userID := h.ownerUserID(r)
	if thread, ok := repo.GetThread(threadID); ok {
		if !isThreadOwnedBy(repo, thread.ID, userID) {
			errcode.Write(w, errcode.ErrNotFound.WithMessage("thread not found"))
			return
		}
		writeSuccess(w, http.StatusOK, thread)
		return
	}
	errcode.Write(w, errcode.ErrNotFound.WithMessage("thread not found"))
}

func (h *Handler) PatchThread(w http.ResponseWriter, r *http.Request, threadID string) {
	var req struct {
		Title  *string `json:"title"`
		Status *string `json:"status"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		errcode.Write(w, errcode.ErrInvalidJSON)
		return
	}
	if req.Status != nil {
		normalized := strings.ToLower(strings.TrimSpace(*req.Status))
		if normalized != "active" && normalized != "archived" {
			errcode.Write(w, errcode.ErrBadRequest.WithMessage("status must be active or archived"))
			return
		}
		req.Status = &normalized
	}
	if req.Title != nil {
		trimmed := strings.TrimSpace(*req.Title)
		req.Title = &trimmed
	}
	thread, ok := ensureStore(h).UpdateThread(threadID, req.Title, req.Status)
	if !ok {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("thread not found"))
		return
	}
	h.Bus.Publish("thread.updated", map[string]any{
		"projectId": thread.ProjectID,
		"threadId":  thread.ID,
	}, thread)
	writeSuccess(w, http.StatusOK, thread)
}

func (h *Handler) DeleteThread(w http.ResponseWriter, r *http.Request, threadID string) {
	if ok := ensureStore(h).DeleteThread(threadID); !ok {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("thread not found"))
		return
	}
	h.Bus.Publish("thread.deleted", map[string]any{"threadId": threadID}, map[string]any{"threadId": threadID})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ArchiveThread(w http.ResponseWriter, r *http.Request, threadID string) {
	status := "archived"
	thread, ok := ensureStore(h).UpdateThread(threadID, nil, &status)
	if !ok {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("thread not found"))
		return
	}
	h.Bus.Publish("thread.updated", map[string]any{
		"projectId": thread.ProjectID,
		"threadId":  thread.ID,
	}, thread)
	writeSuccess(w, http.StatusAccepted, thread)
}

func (h *Handler) GetThreadItems(w http.ResponseWriter, r *http.Request, threadID string) {
	repository := ensureStore(h)
	userID := h.ownerUserID(r)
	if _, ok := repository.GetThread(threadID); !ok || !isThreadOwnedBy(repository, threadID, userID) {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("thread not found"))
		return
	}
	writeSuccess(w, http.StatusOK, listResponse(repository.ListThreadItems(threadID)))
}

func (h *Handler) PostThreadMessage(w http.ResponseWriter, r *http.Request, threadID string) {
	var req struct {
		Content string `json:"content"`
		Role    string `json:"role"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		errcode.Write(w, errcode.ErrInvalidJSON)
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		errcode.Write(w, errcode.ErrContentRequired)
		return
	}

	repo := ensureStore(h)
	role := strings.TrimSpace(req.Role)
	if role == "" {
		role = "user"
	}

	// Look up thread to get project ID for the new item.
	thread, ok := repo.GetThread(threadID)
	if !ok {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("thread not found"))
		return
	}

	// For user messages, look up the current user profile to set sender info.
	var senderID, senderName string
	if role == "user" {
		if profile, ok := repo.GetCurrentUser(); ok {
			senderID = profile.ID
			senderName = profile.DisplayName
		}
	}

	item, err := repo.CreateItem(store.Item{
		ID:         genID("item_"),
		ProjectID:  thread.ProjectID,
		ThreadID:   threadID,
		Type:       "user_message",
		Role:       role,
		Status:     "created",
		Content:    req.Content,
		SenderID:   senderID,
		SenderName: senderName,
	})
	if err != nil {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("thread not found"))
		return
	}
	scope := map[string]any{
		"projectId": item.ProjectID,
		"threadId":  item.ThreadID,
		"itemId":    item.ID,
	}
	h.Bus.Publish("message.created", scope, item)
	h.Bus.Publish("item.created", scope, item)
	writeSuccess(w, http.StatusCreated, item)
}

func (h *Handler) GetThreadPins(w http.ResponseWriter, r *http.Request, threadID string) {
	repository := ensureStore(h)
	userID := h.ownerUserID(r)
	if _, ok := repository.GetThread(threadID); !ok || !isThreadOwnedBy(repository, threadID, userID) {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("thread not found"))
		return
	}
	pins := repository.ListThreadPins(threadID)
	items := make([]map[string]any, 0, len(pins))
	for _, pin := range pins {
		item, ok := repository.GetItem(pin.ItemID)
		if !ok || item.ThreadID != threadID {
			continue
		}
		items = append(items, map[string]any{
			"threadId":  pin.ThreadID,
			"itemId":    pin.ItemID,
			"pinnedBy":  pin.PinnedBy,
			"pinnedAt":  pin.PinnedAt,
			"createdAt": pin.CreatedAt,
			"updatedAt": pin.UpdatedAt,
			"item":      item,
		})
	}
	writeSuccess(w, http.StatusOK, listResponse(items))
}

func (h *Handler) PostThreadPin(w http.ResponseWriter, r *http.Request, threadID string) {
	var req struct {
		ItemID   string `json:"itemId"`
		PinnedBy string `json:"pinnedBy"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		errcode.Write(w, errcode.ErrInvalidJSON)
		return
	}
	itemID := strings.TrimSpace(req.ItemID)
	if itemID == "" {
		errcode.Write(w, errcode.ErrBadRequest.WithMessage("itemId is required"))
		return
	}
	pin, err := ensureStore(h).PinThreadItem(threadID, itemID, req.PinnedBy)
	if err != nil {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("thread item not found"))
		return
	}
	h.Bus.Publish("thread.pin.created", map[string]any{
		"threadId": threadID,
		"itemId":   itemID,
	}, pin)
	writeSuccess(w, http.StatusCreated, pin)
}

func (h *Handler) DeleteThreadPin(w http.ResponseWriter, r *http.Request, threadID string) {
	itemID := strings.TrimSpace(r.URL.Query().Get("itemId"))
	if itemID == "" {
		errcode.Write(w, errcode.ErrBadRequest.WithMessage("itemId is required"))
		return
	}
	if ok := ensureStore(h).DeleteThreadPin(threadID, itemID); !ok {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("thread pin not found"))
		return
	}
	h.Bus.Publish("thread.pin.deleted", map[string]any{
		"threadId": threadID,
		"itemId":   itemID,
	}, map[string]any{"threadId": threadID, "itemId": itemID})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetItem(w http.ResponseWriter, r *http.Request) {
	itemID := strings.TrimPrefix(r.URL.Path, "/v1/items/")
	repo := ensureStore(h)
	userID := h.ownerUserID(r)
	if item, ok := repo.GetItem(itemID); ok {
		if !isItemOwnedBy(repo, item.ID, userID) {
			errcode.Write(w, errcode.ErrNotFound.WithMessage("item not found"))
			return
		}
		writeSuccess(w, http.StatusOK, item)
		return
	}
	errcode.Write(w, errcode.ErrNotFound.WithMessage("item not found"))
}

func (h *Handler) GetRunDiff(w http.ResponseWriter, r *http.Request, runID string) {
	repository := ensureStore(h)
	userID := h.ownerUserID(r)
	if _, ok := repository.GetRun(runID); !ok || !isRunOwnedBy(repository, runID, userID) {
		errcode.Write(w, errcode.ErrNotFound.WithMessage("run not found"))
		return
	}
	files := repository.ListRunDiffFiles(runID)
	writeSuccess(w, http.StatusOK, map[string]any{
		"runId": runID,
		"files": runDiffFilesResponse(files),
	})
}
