package publicstats

import (
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// statsCacheTTL is the freshness window for public stats. Chosen at 30s to
// reduce messages-table full COUNT from per-request to ~2/min under steady
// load while keeping website counters acceptably fresh. See #2102 F9.
const statsCacheTTL = 30 * time.Second

// PublicStats is the response body for public stats queries.
type PublicStats struct {
	TotalUsers    int64 `json:"totalUsers"`
	TotalAgents   int64 `json:"totalAgents"`
	OnlineAgents  int64 `json:"onlineAgents"`
	TotalMessages int64 `json:"totalMessages"`
}

// PublicStatsService provides public-facing statistics without exposing raw DB access
// to the handler layer.
type PublicStatsService struct {
	db *gorm.DB

	mu       sync.Mutex
	cached   PublicStats
	expireAt time.Time
	inflight *inflight[PublicStats]
}

// inflight coalesces concurrent recomputations so only one goroutine hits the
// DB when the cache expires; others block on the shared result.
type inflight[T any] struct {
	done chan struct{}
	val  T
}

// NewPublicStatsService creates a PublicStatsService backed by the given DB handle.
func NewPublicStatsService(db *gorm.DB) *PublicStatsService {
	return &PublicStatsService{db: db}
}

// GetStats returns counts for users, agents, online agents, and messages.
// Results are cached in-process with a TTL; concurrent callers during an
// expired window share a single recomputation (singleflight semantics).
func (s *PublicStatsService) GetStats() PublicStats {
	s.mu.Lock()
	if time.Now().Before(s.expireAt) {
		v := s.cached
		s.mu.Unlock()
		return v
	}
	if s.inflight != nil {
		f := s.inflight
		s.mu.Unlock()
		<-f.done
		return f.val
	}
	f := &inflight[PublicStats]{done: make(chan struct{})}
	s.inflight = f
	s.mu.Unlock()

	v := s.compute()

	// Publish result BEFORE closing done so waiters always see a fully written val.
	f.val = v

	s.mu.Lock()
	s.cached = v
	s.expireAt = time.Now().Add(statsCacheTTL)
	s.inflight = nil
	s.mu.Unlock()

	close(f.done)
	return v
}

// compute performs the actual DB aggregation. Extracted for testability.
func (s *PublicStatsService) compute() PublicStats {
	var stats PublicStats

	// Total registered users
	s.db.Model(&model.User{}).Count(&stats.TotalUsers)

	// Total agent instances ever created
	s.db.Model(&model.AgentInstance{}).Count(&stats.TotalAgents)

	// Online agents: distinct agent instances with an active task
	s.db.Model(&model.PendingAgentTask{}).
		Where("status IN ?", []string{model.TaskStatusRunning, model.TaskStatusDispatched}).
		Distinct("agent_instance_id").
		Count(&stats.OnlineAgents)

	// Total messages
	s.db.Model(&model.Message{}).Count(&stats.TotalMessages)

	return stats
}
