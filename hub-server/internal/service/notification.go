package service

import (
	"context"
	"encoding/json"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/ws"
)

type NotificationService struct {
	db  *gorm.DB
	mgr *ws.Manager
}

func NewNotificationService(db *gorm.DB, mgr *ws.Manager) *NotificationService {
	return &NotificationService{db: db, mgr: mgr}
}

func (s *NotificationService) Notify(ctx context.Context, userID, typ string, payload interface{}) error {
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

func (s *NotificationService) ListNotifications(ctx context.Context, userID string, unreadOnly bool, limit, offset int) ([]model.Notification, error) {
	return repository.ListNotifications(s.db, userID, unreadOnly, limit, offset)
}

func (s *NotificationService) MarkRead(ctx context.Context, userID, notifID string) error {
	if err := repository.MarkNotificationRead(s.db, notifID); err != nil {
		return errcode.NotifNotFound
	}
	return nil
}

func (s *NotificationService) MarkAllRead(ctx context.Context, userID string) error {
	return repository.MarkAllNotificationsRead(s.db, userID)
}
