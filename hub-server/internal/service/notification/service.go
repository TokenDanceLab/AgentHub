package notification

import (
	"context"
	"encoding/json"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/ws"
)

// Service manages user notifications: persistence plus real-time WebSocket
// delivery.
type Service struct {
	db  *gorm.DB
	mgr *ws.Manager
}

// NewService creates a new notification Service.
func NewService(db *gorm.DB, mgr *ws.Manager) *Service {
	return &Service{db: db, mgr: mgr}
}

// Notify creates a notification for userID and pushes it to the user over
// WebSocket.
func (s *Service) Notify(ctx context.Context, userID, typ string, payload interface{}) error {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	n := &model.Notification{
		UserID:  userID,
		Type:    typ,
		Payload: string(payloadBytes),
	}

	if err := repository.CreateNotification(s.db, n); err != nil {
		return err
	}

	frame := ws.NewFrame(ws.TypeNotificationNew, n)
	s.mgr.PushToUser(userID, frame)

	return nil
}

// ListNotifications returns a page of notifications for userID.
func (s *Service) ListNotifications(ctx context.Context, userID string, unreadOnly bool, limit, offset int) ([]model.Notification, error) {
	return repository.ListNotifications(s.db, userID, unreadOnly, limit, offset)
}

// MarkRead marks a single notification as read.
func (s *Service) MarkRead(ctx context.Context, userID, notifID string) error {
	if err := repository.MarkNotificationRead(s.db, userID, notifID); err != nil {
		return errcode.NotifNotFound
	}
	return nil
}

// MarkAllRead marks all of userID's notifications as read.
func (s *Service) MarkAllRead(ctx context.Context, userID string) error {
	return repository.MarkAllNotificationsRead(s.db, userID)
}
