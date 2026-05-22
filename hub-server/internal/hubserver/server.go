package hubserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/agenthub/agenthub/internal/httpapi"
)

type Config struct {
	Addr              string
	Version           string
	ReadHeaderTimeout time.Duration
}

type Server struct {
	cfg     Config
	handler http.Handler
	store   EdgeRegistry
}

type EdgeRegistry interface {
	Register(ctx context.Context, req RegisterEdgeRequest) (EdgeResource, error)
	List(ctx context.Context) ([]EdgeResource, error)
	Get(ctx context.Context, edgeID string) (EdgeResource, error)
	Heartbeat(ctx context.Context, edgeID string, req HeartbeatEdgeRequest) (EdgeResource, error)
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

type ListResponse struct {
	Items []EdgeResource `json:"items"`
	Page  PageInfo       `json:"page"`
}

type PageInfo struct {
	HasMore bool `json:"hasMore"`
}

type InMemoryEdgeRegistry struct {
	mu    sync.Mutex
	edges map[string]EdgeResource
}

func New(cfg Config) *Server {
	cfg = normalizeConfig(cfg)
	s := &Server{
		cfg:   cfg,
		store: NewInMemoryEdgeRegistry(),
	}
	s.handler = s.routes()
	return s
}

func NewInMemoryEdgeRegistry() *InMemoryEdgeRegistry {
	return &InMemoryEdgeRegistry{
		edges: make(map[string]EdgeResource),
	}
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

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/health", s.handleHealth)
	mux.HandleFunc("/v1/edges", s.handleEdges)
	mux.HandleFunc("/v1/edges/", s.handleEdgeResource)
	mux.HandleFunc("/v1/edges:register", s.handleRegisterEdge)
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

	resource, err := s.store.Register(r.Context(), req)
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

	edges, err := s.store.List(r.Context())
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

	edge, err := s.store.Get(r.Context(), path)
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

	edge, err := s.store.Heartbeat(r.Context(), edgeID, req)
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

var errEdgeNotFound = errors.New("edge not found")
