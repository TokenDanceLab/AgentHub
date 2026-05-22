package hubserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/agenthub/agenthub/internal/httpapi"
	"github.com/agenthub/agenthub/packages/protocol"
)

type Config struct {
	Addr              string
	Version           string
	ReadHeaderTimeout time.Duration
}

type Server struct {
	cfg       Config
	handler   http.Handler
	edgeStore EdgeRegistry
	syncStore SyncStore
}

type EdgeRegistry interface {
	Register(ctx context.Context, req RegisterEdgeRequest) (EdgeResource, error)
	List(ctx context.Context) ([]EdgeResource, error)
	Get(ctx context.Context, edgeID string) (EdgeResource, error)
	Heartbeat(ctx context.Context, edgeID string, req HeartbeatEdgeRequest) (EdgeResource, error)
}

type SyncStore interface {
	Upload(ctx context.Context, req UploadSyncEventsRequest) (SyncUploadResult, error)
	List(ctx context.Context, cursor string) ([]SyncEventResource, string, error)
	Ack(ctx context.Context, req AckSyncRequest) (SyncState, error)
	State(ctx context.Context) (SyncState, error)
}

type RegisterEdgeRequest struct {
	Name     string `json:"name"`
	Endpoint string `json:"endpoint,omitempty"`
	DeviceID string `json:"deviceId,omitempty"`
}

type EdgeResource struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Status       string `json:"status"`
	Endpoint     string `json:"endpoint,omitempty"`
	DeviceID     string `json:"deviceId,omitempty"`
	RegisteredAt string `json:"registeredAt"`
	HeartbeatAt  string `json:"heartbeatAt,omitempty"`
}

type HeartbeatEdgeRequest struct {
	Status string `json:"status,omitempty"`
}

type UploadSyncEventsRequest struct {
	Events []protocol.EventEnvelope `json:"events"`
}

type SyncEventResource struct {
	Cursor string                 `json:"cursor"`
	Event  protocol.EventEnvelope `json:"event"`
}

type SyncUploadResult struct {
	Accepted   int    `json:"accepted"`
	NextCursor string `json:"nextCursor"`
}

type AckSyncRequest struct {
	Cursor string `json:"cursor"`
}

type SyncState struct {
	LastCursor    string `json:"lastCursor,omitempty"`
	LastAckCursor string `json:"lastAckCursor,omitempty"`
	Pending       int    `json:"pending"`
}

type ListResponse struct {
	Items any      `json:"items"`
	Page  PageInfo `json:"page"`
}

type PageInfo struct {
	NextCursor string `json:"nextCursor,omitempty"`
	HasMore    bool   `json:"hasMore"`
}

type InMemoryEdgeRegistry struct {
	mu    sync.Mutex
	edges map[string]EdgeResource
}

type InMemorySyncStore struct {
	mu            sync.Mutex
	events        []SyncEventResource
	lastAckCursor string
}

func New(cfg Config) *Server {
	cfg = normalizeConfig(cfg)
	s := &Server{
		cfg:       cfg,
		edgeStore: NewInMemoryEdgeRegistry(),
		syncStore: NewInMemorySyncStore(),
	}
	s.handler = s.routes()
	return s
}

func NewInMemoryEdgeRegistry() *InMemoryEdgeRegistry {
	return &InMemoryEdgeRegistry{
		edges: make(map[string]EdgeResource),
	}
}

func NewInMemorySyncStore() *InMemorySyncStore {
	return &InMemorySyncStore{}
}

func (s *Server) Handler() http.Handler {
	return s.handler
}

func (s *Server) Run(ctx context.Context) error {
	server := &http.Server{
		Addr:              s.cfg.Addr,
		Handler:           s.handler,
		ReadHeaderTimeout: s.cfg.ReadHeaderTimeout,
	}

	errc := make(chan error, 1)
	go func() {
		err := server.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- err
			return
		}
		errc <- nil
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return err
		}
		return <-errc
	case err := <-errc:
		return err
	}
}

func (r *InMemoryEdgeRegistry) Register(_ context.Context, req RegisterEdgeRequest) (EdgeResource, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return EdgeResource{}, errors.New("edge name is required")
	}

	resource := EdgeResource{
		ID:           newID("edge"),
		Kind:         "edge",
		Name:         name,
		Status:       "registered",
		Endpoint:     strings.TrimSpace(req.Endpoint),
		DeviceID:     strings.TrimSpace(req.DeviceID),
		RegisteredAt: time.Now().UTC().Format(time.RFC3339),
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	r.edges[resource.ID] = resource

	return resource, nil
}

func (r *InMemoryEdgeRegistry) List(_ context.Context) ([]EdgeResource, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	edges := make([]EdgeResource, 0, len(r.edges))
	for _, edge := range r.edges {
		edges = append(edges, edge)
	}
	sort.Slice(edges, func(i, j int) bool {
		return edges[i].ID < edges[j].ID
	})
	return edges, nil
}

func (r *InMemoryEdgeRegistry) Get(_ context.Context, edgeID string) (EdgeResource, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	edge, ok := r.edges[edgeID]
	if !ok {
		return EdgeResource{}, errEdgeNotFound
	}
	return edge, nil
}

func (r *InMemoryEdgeRegistry) Heartbeat(_ context.Context, edgeID string, req HeartbeatEdgeRequest) (EdgeResource, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	edge, ok := r.edges[edgeID]
	if !ok {
		return EdgeResource{}, errEdgeNotFound
	}
	if status := strings.TrimSpace(req.Status); status != "" {
		edge.Status = status
	} else {
		edge.Status = "online"
	}
	edge.HeartbeatAt = time.Now().UTC().Format(time.RFC3339)
	r.edges[edgeID] = edge

	return edge, nil
}

func (s *InMemorySyncStore) Upload(_ context.Context, req UploadSyncEventsRequest) (SyncUploadResult, error) {
	if len(req.Events) == 0 {
		return SyncUploadResult{}, errors.New("sync events are required")
	}
	for _, event := range req.Events {
		if err := event.Validate(); err != nil {
			return SyncUploadResult{}, err
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, event := range req.Events {
		cursor := newSyncCursor(len(s.events) + 1)
		s.events = append(s.events, SyncEventResource{
			Cursor: cursor,
			Event:  event,
		})
	}

	return SyncUploadResult{
		Accepted:   len(req.Events),
		NextCursor: s.events[len(s.events)-1].Cursor,
	}, nil
}

func (s *InMemorySyncStore) List(_ context.Context, cursor string) ([]SyncEventResource, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	start := 0
	if cursor != "" {
		for i, event := range s.events {
			if event.Cursor == cursor {
				start = i + 1
				break
			}
		}
	}

	items := append([]SyncEventResource(nil), s.events[start:]...)
	nextCursor := ""
	if len(items) > 0 {
		nextCursor = items[len(items)-1].Cursor
	}
	return items, nextCursor, nil
}

func (s *InMemorySyncStore) Ack(_ context.Context, req AckSyncRequest) (SyncState, error) {
	cursor := strings.TrimSpace(req.Cursor)
	if cursor == "" {
		return SyncState{}, errors.New("sync cursor is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.lastAckCursor = cursor
	return s.stateLocked(), nil
}

func (s *InMemorySyncStore) State(_ context.Context) (SyncState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.stateLocked(), nil
}

func (s *InMemorySyncStore) stateLocked() SyncState {
	lastCursor := ""
	if len(s.events) > 0 {
		lastCursor = s.events[len(s.events)-1].Cursor
	}

	pending := len(s.events)
	if s.lastAckCursor != "" {
		for i, event := range s.events {
			if event.Cursor == s.lastAckCursor {
				pending = len(s.events) - i - 1
				break
			}
		}
	}

	return SyncState{
		LastCursor:    lastCursor,
		LastAckCursor: s.lastAckCursor,
		Pending:       pending,
	}
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/health", s.handleHealth)
	mux.HandleFunc("/v1/edges", s.handleEdges)
	mux.HandleFunc("/v1/edges/", s.handleEdgeResource)
	mux.HandleFunc("/v1/edges:register", s.handleRegisterEdge)
	mux.HandleFunc("/v1/sync/events", s.handleSyncEvents)
	mux.HandleFunc("/v1/sync/events:upload", s.handleUploadSyncEvents)
	mux.HandleFunc("/v1/sync/ack", s.handleAckSync)
	mux.HandleFunc("/v1/sync/state", s.handleSyncState)
	mux.HandleFunc("/", httpapi.HandleNotFound)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpapi.WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method not allowed", "", nil)
		return
	}

	httpapi.WriteJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "hub-server",
		"version": s.cfg.Version,
	})
}

func (s *Server) handleRegisterEdge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpapi.WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method not allowed", "", nil)
		return
	}

	var req RegisterEdgeRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "bad_request", "请求 JSON 非法", "", nil)
		return
	}

	resource, err := s.edgeStore.Register(r.Context(), req)
	if err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "bad_request", "Edge 名称不能为空", "", map[string]string{
			"field": "name",
		})
		return
	}

	httpapi.WriteJSON(w, http.StatusCreated, resource)
}

func (s *Server) handleEdges(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpapi.WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method not allowed", "", nil)
		return
	}

	edges, err := s.edgeStore.List(r.Context())
	if err != nil {
		httpapi.WriteError(w, http.StatusInternalServerError, "internal_error", "服务内部错误", "", nil)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, ListResponse{
		Items: edges,
		Page:  PageInfo{HasMore: false},
	})
}

func (s *Server) handleEdgeResource(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/edges/")
	if strings.HasSuffix(path, ":heartbeat") {
		edgeID := strings.TrimSuffix(path, ":heartbeat")
		s.handleHeartbeatEdge(w, r, edgeID)
		return
	}

	if r.Method != http.MethodGet {
		httpapi.WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method not allowed", "", nil)
		return
	}

	edge, err := s.edgeStore.Get(r.Context(), path)
	if errors.Is(err, errEdgeNotFound) {
		httpapi.WriteError(w, http.StatusNotFound, "not_found", "Edge 不存在", "", nil)
		return
	}
	if err != nil {
		httpapi.WriteError(w, http.StatusInternalServerError, "internal_error", "服务内部错误", "", nil)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, edge)
}

func (s *Server) handleHeartbeatEdge(w http.ResponseWriter, r *http.Request, edgeID string) {
	if r.Method != http.MethodPost {
		httpapi.WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method not allowed", "", nil)
		return
	}

	var req HeartbeatEdgeRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "bad_request", "请求 JSON 非法", "", nil)
		return
	}

	edge, err := s.edgeStore.Heartbeat(r.Context(), edgeID, req)
	if errors.Is(err, errEdgeNotFound) {
		httpapi.WriteError(w, http.StatusNotFound, "not_found", "Edge 不存在", "", nil)
		return
	}
	if err != nil {
		httpapi.WriteError(w, http.StatusInternalServerError, "internal_error", "服务内部错误", "", nil)
		return
	}
	httpapi.WriteJSON(w, http.StatusAccepted, edge)
}

func (s *Server) handleUploadSyncEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpapi.WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method not allowed", "", nil)
		return
	}

	var req UploadSyncEventsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "bad_request", "请求 JSON 非法", "", nil)
		return
	}

	result, err := s.syncStore.Upload(r.Context(), req)
	if err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "bad_request", "同步事件非法", "", nil)
		return
	}
	httpapi.WriteJSON(w, http.StatusAccepted, result)
}

func (s *Server) handleSyncEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpapi.WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method not allowed", "", nil)
		return
	}

	items, nextCursor, err := s.syncStore.List(r.Context(), r.URL.Query().Get("pageCursor"))
	if err != nil {
		httpapi.WriteError(w, http.StatusInternalServerError, "internal_error", "服务内部错误", "", nil)
		return
	}

	httpapi.WriteJSON(w, http.StatusOK, ListResponse{
		Items: items,
		Page: PageInfo{
			NextCursor: nextCursor,
			HasMore:    false,
		},
	})
}

func (s *Server) handleAckSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpapi.WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method not allowed", "", nil)
		return
	}

	var req AckSyncRequest
	if err := decodeJSON(w, r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "bad_request", "请求 JSON 非法", "", nil)
		return
	}

	state, err := s.syncStore.Ack(r.Context(), req)
	if err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "bad_request", "同步游标不能为空", "", nil)
		return
	}
	httpapi.WriteJSON(w, http.StatusAccepted, state)
}

func (s *Server) handleSyncState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpapi.WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method not allowed", "", nil)
		return
	}

	state, err := s.syncStore.State(r.Context())
	if err != nil {
		httpapi.WriteError(w, http.StatusInternalServerError, "internal_error", "服务内部错误", "", nil)
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, state)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func normalizeConfig(cfg Config) Config {
	if cfg.Addr == "" {
		cfg.Addr = ":8080"
	}
	if cfg.Version == "" {
		cfg.Version = "dev"
	}
	if cfg.ReadHeaderTimeout == 0 {
		cfg.ReadHeaderTimeout = 5 * time.Second
	}
	return cfg
}

func newID(prefix string) string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return prefix + "_" + time.Now().UTC().Format("20060102150405")
	}
	return prefix + "_" + hex.EncodeToString(b[:])
}

func newSyncCursor(seq int) string {
	return "sync_" + strings.TrimLeft(time.Now().UTC().Format("20060102150405.000000000"), "0") + "_" + strconv.Itoa(seq)
}

var errEdgeNotFound = errors.New("edge not found")
