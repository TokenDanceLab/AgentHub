package store

import (
	"errors"
	"fmt"
)

// Run admission lifecycle states persisted alongside Hub task identity.
const (
	RunAdmissionPending  = "pending"
	RunAdmissionAccepted = "accepted"
	RunAdmissionRejected = "rejected"
)

var (
	ErrRunAdmissionHubTaskIDRequired = errors.New("run admission hub task id is required")
	ErrRunAdmissionInvalidTransition = errors.New("invalid run admission transition")
	ErrRunAdmissionExists            = errors.New("run admission already exists")
)

// CreateRunAdmission creates a run and records its Hub task identity and pending
// admission atomically under one Store lock. It reuses the existing run create
// validation/order helper; only the non-empty HubTaskID and admission marker are new.
func (s *Store) CreateRunAdmission(id, projectID, threadID, hubTaskID, callbackOwner string) (Run, error) {
	if hubTaskID == "" {
		return Run{}, ErrRunAdmissionHubTaskIDRequired
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	_, existed := s.runs[id]
	run, order, err := createRunInMaps(s.projects, s.threads, s.runs, s.runOrder, id, projectID, threadID, nowString())
	if err != nil {
		return Run{}, err
	}
	if existed {
		if run.AdmissionState == RunAdmissionPending &&
			run.HubTaskID == hubTaskID &&
			run.ProjectID == projectID &&
			run.ThreadID == threadID && run.CallbackOwner == callbackOwner {
			return run, nil
		}
		return Run{}, admissionCreateConflictError(id, hubTaskID, projectID, threadID, run)
	}

	s.runOrder = order
	run.HubTaskID = hubTaskID
	run.CallbackOwner = callbackOwner
	run.AdmissionState = RunAdmissionPending
	run.AdmissionErrorCode = ""
	s.runs[id] = run
	return run, nil
}

// RecordRunAdmission records the final executor admission outcome. An empty
// errorCode means accepted; a non-empty code means rejected and is retained as
// the public-safe error identity. Pending is the only pre-final state. Repeating
// the same final outcome is idempotent; any other transition is rejected. This
// method intentionally mutates only the admission fields, never execution metadata.
func (s *Store) RecordRunAdmission(id, errorCode string) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	run, ok := s.runs[id]
	if !ok {
		return Run{}, ErrNotFound
	}
	nextState := RunAdmissionAccepted
	if errorCode != "" {
		nextState = RunAdmissionRejected
	}
	switch run.AdmissionState {
	case RunAdmissionPending:
		run.AdmissionState = nextState
		if nextState == RunAdmissionAccepted {
			run.AdmissionErrorCode = ""
		} else {
			run.AdmissionErrorCode = errorCode
		}
		s.runs[id] = run
		return run, nil
	case RunAdmissionAccepted:
		if nextState != RunAdmissionAccepted || errorCode != "" {
			return run, admissionTransitionError(run.AdmissionState, nextState, errorCode)
		}
		return run, nil
	case RunAdmissionRejected:
		if nextState != RunAdmissionRejected || run.AdmissionErrorCode != errorCode {
			return run, admissionTransitionError(run.AdmissionState, nextState, errorCode)
		}
		return run, nil
	default:
		return run, admissionTransitionError(run.AdmissionState, nextState, errorCode)
	}
}

func admissionTransitionError(from, to, errorCode string) error {
	return fmt.Errorf("%w: run admission transition %q -> %q with error code %q", ErrRunAdmissionInvalidTransition, from, to, errorCode)
}

func admissionCreateConflictError(id, hubTaskID, projectID, threadID string, existing Run) error {
	return fmt.Errorf("%w: %w: run %q already has admission identity %q in project/thread %q/%q; requested %q in %q/%q", ErrRunAdmissionInvalidTransition, ErrRunAdmissionExists, id, existing.HubTaskID, existing.ProjectID, existing.ThreadID, hubTaskID, projectID, threadID)
}
