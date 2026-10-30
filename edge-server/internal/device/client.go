// Package device implements the outbound, device-scoped Hub connection.
// A device credential is never a product session or a model provider key.
package device

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrUnauthorized = errors.New("edge credential expired or revoked; pair this device again")

type Client struct {
	origin     string
	http       *http.Client
	credential string
}

// NewClient requires HTTPS even on loopback. Tests inject a TLS test transport.
// Redirects are refused so a credential never follows a Hub redirect.
func NewClient(origin, credential string, transport *http.Client) (*Client, error) {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("hub URL must be an HTTPS origin without credentials, path, query or fragment")
	}
	if transport == nil {
		return nil, errors.New("device client requires an HTTP transport")
	}
	client := *transport
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	client.Timeout = 30 * time.Second
	return &Client{origin: strings.TrimRight(origin, "/"), credential: credential, http: &client}, nil
}

type StartRequest struct {
	DeviceID      string `json:"device_id"`
	Name          string `json:"name"`
	RuntimeID     string `json:"runtime_id"`
	WorkspaceRoot string `json:"workspace_root"`
}

type Enrollment struct {
	ID         string    `json:"enrollment_id"`
	UserCode   string    `json:"user_code"`
	PollSecret string    `json:"poll_secret"`
	ExpiresAt  time.Time `json:"expires_at"`
}

type Credential struct {
	HubURL        string    `json:"hub_url"`
	DeviceID      string    `json:"device_id"`
	TargetID      string    `json:"target_id"`
	Secret        string    `json:"credential"`
	ExpiresAt     time.Time `json:"expires_at"`
	RuntimeID     string    `json:"runtime_id"`
	WorkspaceRoot string    `json:"workspace_root"`
}

func (c *Client) Start(ctx context.Context, req StartRequest) (Enrollment, error) {
	var result Enrollment
	_, err := c.request(ctx, http.MethodPost, "/edge/enrollments/start", req, &result)
	if err == nil && (result.ID == "" || result.UserCode == "" || result.PollSecret == "" || !result.ExpiresAt.After(time.Now())) {
		err = errors.New("hub returned invalid enrollment")
	}
	return result, err
}

func (c *Client) Exchange(ctx context.Context, enrollment Enrollment) (Credential, bool, error) {
	var result Credential
	status, err := c.request(ctx, http.MethodPost, "/edge/enrollments/exchange", map[string]string{"enrollment_id": enrollment.ID, "poll_secret": enrollment.PollSecret}, &result)
	if err != nil {
		return result, false, err
	}
	if status == http.StatusAccepted {
		return result, true, nil
	}
	result.HubURL = c.origin
	return result, false, result.Validate()
}

func (c *Client) Heartbeat(ctx context.Context) error {
	_, err := c.request(ctx, http.MethodPost, "/edge/device/heartbeat", struct{}{}, nil)
	return err
}

type Delivery struct {
	ID         string          `json:"delivery_id"`
	TaskID     string          `json:"task_id"`
	RunRequest json.RawMessage `json:"run_request"`
}

type Control struct {
	ID     string `json:"control_id"`
	TaskID string `json:"task_id"`
	RunID  string `json:"run_id"`
	Kind   string `json:"kind"`
}

type Batch struct {
	Deliveries []Delivery `json:"deliveries"`
	Controls   []Control  `json:"controls"`
}

func (c *Client) Poll(ctx context.Context) (Batch, error) {
	var result Batch
	_, err := c.request(ctx, http.MethodGet, "/edge/device/poll?wait_seconds=20", nil, &result)
	return result, err
}

func (c *Client) AckControl(ctx context.Context, control Control, status, reason string) error {
	if !validIdentifier(control.ID) || control.ID != control.TaskID || (control.RunID != "" && !validIdentifier(control.RunID)) || (status != "applied" && status != "failed") {
		return errors.New("invalid control identifier")
	}
	_, err := c.request(ctx, http.MethodPost, "/edge/device/controls/"+control.ID+"/ack", map[string]string{"task_id": control.TaskID, "run_id": control.RunID, "status": status, "error": reason}, nil)
	return err
}

// request never includes response bodies, URLs or transport errors in errors:
// upstream bodies and faulty transports can contain credentials or prompts.
func (c *Client) request(ctx context.Context, method, path string, body, target any) (int, error) {
	var encoded []byte
	var err error
	if body != nil {
		encoded, err = json.Marshal(body)
		if err != nil {
			return 0, errors.New("cannot encode device request")
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.origin+path, bytes.NewReader(encoded))
	if err != nil {
		return 0, errors.New("cannot construct device request")
	}
	req.Header.Set("Content-Type", "application/json")
	if c.credential != "" {
		req.Header.Set("Authorization", "Bearer "+c.credential)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		return 0, errors.New("hub device transport unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return resp.StatusCode, ErrUnauthorized
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("hub device request rejected (HTTP %d)", resp.StatusCode)
	}
	const maxBody = 2 << 20
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil || len(data) > maxBody {
		return resp.StatusCode, errors.New("invalid Hub device response size")
	}
	var envelope struct {
		Code string          `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(data, &envelope) != nil || envelope.Code != "ok" {
		return resp.StatusCode, errors.New("hub rejected device request")
	}
	if target != nil && json.Unmarshal(envelope.Data, target) != nil {
		return resp.StatusCode, errors.New("invalid Hub device response")
	}
	return resp.StatusCode, nil
}

func validIdentifier(id string) bool {
	if len(id) == 0 || len(id) > 128 {
		return false
	}
	for _, c := range id {
		if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '-' && c != '_' {
			return false
		}
	}
	return true
}
