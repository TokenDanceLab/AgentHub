package ws

import "encoding/json"

type Frame struct {
	Type    string      `json:"type"`
	SeqID   int64       `json:"seq_id,omitempty"`
	Payload interface{} `json:"payload,omitempty"`
}

const (
	TypeAuth   = "auth"
	TypeTyping = "typing"

	TypeAuthOK   = "auth.ok"
	TypeAuthFail = "auth.fail"

	TypeMessageNew          = "message.new"
	TypeMessageRecall       = "message.recall"
	TypeMessagePin          = "message.pin"
	TypeMessageUnpin        = "message.unpin"
	TypeMessageRead         = "message.read"
	TypeSessionCreated      = "session.created"
	TypeSessionDissolved    = "session.dissolved"
	TypeSessionMemberJoined = "session.member_joined"
	TypeSessionMemberLeft   = "session.member_left"
	TypeSessionInfoUpdated  = "session.info_updated"
	TypeDeviceOnline        = "device.online"
	TypeDeviceOffline       = "device.offline"
	TypeDeviceKicked        = "device.kicked"
	TypeAgentDispatch       = "agent.dispatch"
	TypeAgentStream         = "agent.stream"
	TypeAgentDone           = "agent.done"
	TypeAgentFailed         = "agent.failed"
	TypeAgentCancel         = "agent.cancel"
	TypeNotificationNew     = "notification.new"
	TypeFriendRequest       = "friend.request"
	TypeFriendAccepted      = "friend.accepted"
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
