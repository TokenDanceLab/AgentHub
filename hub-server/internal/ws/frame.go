package ws

import "encoding/json"

// Frame is the Hub /client/ws wire envelope.
//
// SeqID is a per-connection delivery counter stamped by Manager.PushToConn; it
// is NOT a cross-connection business idempotency key. Duplicate-delivery /
// apply semantics for each Type* constant are documented in api/events.md
// (UPSERT by id / idempotent on apply / watermark / ephemeral). Keep this
// const block 1:1 with app/shared/src/hubEvents.ts and OpenAPI HubWebSocketFrame.
type Frame struct {
	Type    string      `json:"type"`
	SeqID   int64       `json:"seq_id,omitempty"`
	Payload interface{} `json:"payload,omitempty"`
}

const (
	// TypeTyping is client→server fanout; ephemeral, no durable apply key.
	TypeTyping = "typing"

	// TypeAuthOK is the post-upgrade handshake ack; idempotent on apply per conn.
	TypeAuthOK = "auth.ok"

	// Message family: UPSERT / idempotent by message or (session, message) ids;
	// message.read advances last_read_seq watermark only.
	TypeMessageNew             = "message.new"
	TypeMessageRecall          = "message.recall"
	TypeMessagePin             = "message.pin"
	TypeMessageUnpin           = "message.unpin"
	TypeMessageReactionAdded   = "message.reaction_added"
	TypeMessageReactionRemoved = "message.reaction_removed"
	TypeMessageRead            = "message.read"

	// Session family: UPSERT / terminal idempotent by session_id (+ member_id).
	TypeSessionCreated      = "session.created"
	TypeSessionDissolved    = "session.dissolved"
	TypeSessionMemberJoined = "session.member_joined"
	TypeSessionMemberLeft   = "session.member_left"
	TypeSessionInfoUpdated  = "session.info_updated"

	// Device family: presence UPSERT by user_id; kicked is terminal per conn.
	TypeDeviceOnline  = "device.online"
	TypeDeviceOffline = "device.offline"
	TypeDeviceKicked  = "device.kicked"

	// Agent family: UPSERT / terminal by task_id; stream also watermarks event_seq.
	// Offline dispatch/control may redeliver — receivers must apply idempotently.
	TypeAgentDispatch = "agent.dispatch"
	TypeAgentStream   = "agent.stream"
	TypeAgentDone     = "agent.done"
	TypeAgentFailed   = "agent.failed"
	TypeAgentCancel   = "agent.cancel"
	TypeAgentControl  = "agent.control"

	// Team family: UPSERT / terminal by run_id or assignment id (see api/events.md).
	TypeTeamRunStarted       = "team.run.started"
	TypeTeamEvent            = "team.event"
	TypeTeamAssignmentDone   = "team.assignment.done"
	TypeTeamAssignmentFailed = "team.assignment.failed"

	// Social: notification UPSERT by id; friend.* by request/user id.
	TypeNotificationNew = "notification.new"
	TypeFriendRequest   = "friend.request"
	TypeFriendAccepted  = "friend.accepted"
)

func NewFrame(typ string, payload interface{}) Frame {
	return Frame{Type: typ, Payload: payload}
}

func (f *Frame) Marshal() ([]byte, error) {
	return json.Marshal(f)
}

func ParseFrame(data []byte) (*Frame, error) {
	var f Frame
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, err
	}
	return &f, nil
}
