package auth

import (
	"context"
	"time"

	"github.com/agenthub/hub-server/internal/model"
)

// PruneExpiredSessions bounds each cleanup transaction. Epoch rows deliberately
// never expire: deleting a revocation generation could revive an old credential.
func (s *Service) PruneExpiredSessions(ctx context.Context) error {
	now := time.Now().UTC()
	if err := s.db.WithContext(ctx).Where("token_hash IN (SELECT token_hash FROM browser_sessions WHERE expires_at < ? ORDER BY expires_at LIMIT 1000)", now).Delete(&model.BrowserSession{}).Error; err != nil {
		return err
	}
	return s.db.WithContext(ctx).Where("(issuer, jti) IN (SELECT issuer, jti FROM oidc_logout_events WHERE expires_at < ? ORDER BY expires_at LIMIT 1000)", now).Delete(&model.OIDCLogoutEvent{}).Error
}
