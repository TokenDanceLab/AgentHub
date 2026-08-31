package session

import "github.com/agenthub/hub-server/internal/model"

// ApplyGroupInfoChanges mutates session fields from optional pointers and returns
// the change map published on session.info_updated. Nil pointers are ignored.
// Pure: no DB/cache/bus side effects.
func ApplyGroupInfoChanges(session *model.Session, name, avatarURL, announcement *string) map[string]interface{} {
	changes := make(map[string]interface{})
	if session == nil {
		return changes
	}
	if name != nil {
		session.Name = *name
		changes["name"] = *name
	}
	if avatarURL != nil {
		session.AvatarURL = *avatarURL
		changes["avatar_url"] = *avatarURL
	}
	if announcement != nil {
		session.Announcement = *announcement
		changes["announcement"] = *announcement
	}
	return changes
}

// SessionMembersCacheKey is the Redis/cache key for active member lists.
func SessionMembersCacheKey(sessionID string) string {
	return "session:members:" + sessionID
}
