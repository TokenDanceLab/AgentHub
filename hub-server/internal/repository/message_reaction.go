package repository

import (
	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func AddReaction(db *gorm.DB, reaction *model.MessageReaction) error {
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(reaction).Error
}

func RemoveReaction(db *gorm.DB, sessionID, messageID, userID, reaction string) error {
	return db.
		Where("session_id = ? AND message_id = ? AND user_id = ? AND emoji = ?", sessionID, messageID, userID, reaction).
		Delete(&model.MessageReaction{}).Error
}

func ListReactionsByMessage(db *gorm.DB, sessionID, messageID string) ([]model.MessageReaction, error) {
	var reactions []model.MessageReaction
	err := db.
		Where("session_id = ? AND message_id = ?", sessionID, messageID).
		Order("created_at ASC, id ASC").
		Limit(500).
		Find(&reactions).Error
	return reactions, err
}

func ListReactionsByMessages(db *gorm.DB, sessionID string, messageIDs []string) (map[string][]model.MessageReaction, error) {
	result := make(map[string][]model.MessageReaction)
	if len(messageIDs) == 0 {
		return result, nil
	}

	var reactions []model.MessageReaction
	err := db.
		Where("session_id = ? AND message_id IN ?", sessionID, messageIDs).
		Order("created_at ASC, id ASC").
		Find(&reactions).Error
	if err != nil {
		return nil, err
	}

	for _, reaction := range reactions {
		result[reaction.MessageID] = append(result[reaction.MessageID], reaction)
	}
	return result, nil
}

func ReactionCountsByMessage(db *gorm.DB, sessionID string, messageIDs []string) (map[string]int64, error) {
	result := make(map[string]int64)
	if len(messageIDs) == 0 {
		return result, nil
	}

	type countRow struct {
		MessageID string
		Count     int64
	}
	var rows []countRow
	err := db.
		Model(&model.MessageReaction{}).
		Select("message_id, COUNT(*) AS count").
		Where("session_id = ? AND message_id IN ?", sessionID, messageIDs).
		Group("message_id").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		result[row.MessageID] = row.Count
	}
	return result, nil
}

func ReactionSummariesByMessage(db *gorm.DB, sessionID, messageID string) ([]model.ReactionSummary, error) {
	reactions, err := ListReactionsByMessage(db, sessionID, messageID)
	if err != nil {
		return nil, err
	}

	summaryIndex := make(map[string]int)
	summaries := make([]model.ReactionSummary, 0)
	for _, reaction := range reactions {
		idx, ok := summaryIndex[reaction.Reaction]
		if !ok {
			idx = len(summaries)
			summaryIndex[reaction.Reaction] = idx
			summaries = append(summaries, model.ReactionSummary{Reaction: reaction.Reaction})
		}

		summaries[idx].Count++
		summaries[idx].UserIDs = append(summaries[idx].UserIDs, reaction.UserID)
	}
	return summaries, nil
}
