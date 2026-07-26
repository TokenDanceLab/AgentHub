package ws

import "testing"

func BenchmarkFrameMarshal(b *testing.B) {
	f := Frame{
		Type:    TypeAgentDispatch,
		SeqID:   42,
		Payload: map[string]any{"session_id": "session-1", "text": "hello world"},
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = f.Marshal()
	}
}

func BenchmarkFrameParse(b *testing.B) {
	f := Frame{
		Type:    TypeAgentDispatch,
		SeqID:   42,
		Payload: map[string]any{"session_id": "session-1", "text": "hello world"},
	}
	data, err := f.Marshal()
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = ParseFrame(data)
	}
}

func BenchmarkFrameMarshalParseRoundTrip(b *testing.B) {
	f := Frame{
		Type:    TypeAgentDispatch,
		SeqID:   42,
		Payload: map[string]any{"session_id": "session-1", "text": "hello world"},
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		data, _ := f.Marshal()
		_, _ = ParseFrame(data)
	}
}

func BenchmarkFrameMarshalSmall(b *testing.B) {
	f := Frame{Type: TypeTyping}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = f.Marshal()
	}
}

func BenchmarkFrameMarshalWithStringPayload(b *testing.B) {
	f := Frame{
		Type:    TypeAgentStream,
		SeqID:   100,
		Payload: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = f.Marshal()
	}
}

func BenchmarkFrameParseEmpty(b *testing.B) {
	data := []byte(`{"type":"auth.ok"}`)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = ParseFrame(data)
	}
}

func BenchmarkFrameMarshalAllTypes(b *testing.B) {
	types := []string{
		TypeTyping, TypeAuthOK,
		TypeMessageNew, TypeMessageRecall, TypeMessagePin, TypeMessageUnpin,
		TypeMessageReactionAdded, TypeMessageReactionRemoved, TypeMessageRead,
		TypeSessionCreated, TypeSessionDissolved,
		TypeSessionMemberJoined, TypeSessionMemberLeft, TypeSessionInfoUpdated,
		TypeDeviceOnline, TypeDeviceOffline, TypeDeviceKicked,
		TypeAgentDispatch, TypeAgentStream, TypeAgentDone, TypeAgentFailed, TypeAgentCancel, TypeAgentControl,
		TypeTeamRunStarted, TypeTeamEvent, TypeTeamAssignmentDone, TypeTeamAssignmentFailed,
		TypeNotificationNew, TypeFriendRequest, TypeFriendAccepted,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		typ := types[i%len(types)]
		f := NewFrame(typ, map[string]string{"k": "v"})
		_, _ = f.Marshal()
	}
}
