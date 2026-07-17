package dispatch

import "github.com/agenthub/hub-server/internal/errcode"

// MapTriggerMessageLookupError maps a trigger-message GetByID failure to MsgNotFound
// (historical TriggerAgentTask collapse of any lookup error).
func MapTriggerMessageLookupError(err error) error {
	if err != nil {
		return errcode.MsgNotFound
	}
	return nil
}

// MapSessionLookupError maps a session GetByID failure to SessionNotFound.
func MapSessionLookupError(err error) error {
	if err != nil {
		return errcode.SessionNotFound
	}
	return nil
}

// MapPendingTaskLookupError maps a pending-task lookup error. notFound is true when
// the repository reported gorm.ErrRecordNotFound (caller owns errors.Is so this
// package stays free of gorm). Other errors pass through unchanged.
func MapPendingTaskLookupError(err error, notFound bool) error {
	if err == nil {
		return nil
	}
	if notFound {
		return errcode.AgentTaskNotFound
	}
	return err
}

// MapTargetLookupError maps an execution-target lookup error. notFound → TargetNotFound;
// other errors pass through.
func MapTargetLookupError(err error, notFound bool) error {
	if err == nil {
		return nil
	}
	if notFound {
		return errcode.TargetNotFound
	}
	return err
}

// MapBoundDeviceLookupError maps a bound-device lookup error. notFound → historical
// DeviceMissingNotRoutable; other errors pass through.
func MapBoundDeviceLookupError(err error, notFound bool) error {
	if err == nil {
		return nil
	}
	if notFound {
		return DeviceMissingNotRoutable()
	}
	return err
}
