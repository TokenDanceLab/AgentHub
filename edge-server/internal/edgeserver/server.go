package edgeserver

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/agenthub/agenthub/internal/httpapi"
)

type Config struct {
	Addr              string
	Version           string
	EdgeID            string
	ReadHeaderTimeout time.Duration
}

type Server struct {
	cfg     Config
	handler http.Handler
}

func New(cfg Config) *Server {
	cfg = normalizeConfig(cfg)
	s := &Server{
		cfg: cfg,
	}
	s.handler = s.routes()
	return s
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

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/health", s.handleHealth)
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
		"service": "edge-server",
		"version": s.cfg.Version,
		"edgeId":  s.cfg.EdgeID,
	})
}

func normalizeConfig(cfg Config) Config {
	if cfg.Addr == "" {
		cfg.Addr = ":8081"
	}
	if cfg.Version == "" {
		cfg.Version = "dev"
	}
	if cfg.EdgeID == "" {
		cfg.EdgeID = "edge_local"
	}
	if cfg.ReadHeaderTimeout == 0 {
		cfg.ReadHeaderTimeout = 5 * time.Second
	}
	return cfg
}
