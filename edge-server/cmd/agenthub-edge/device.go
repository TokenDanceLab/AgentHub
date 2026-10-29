package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/agenthub/edge-server/internal/device"
	"github.com/agenthub/edge-server/internal/edgehttp"
	"github.com/google/uuid"
)

func (cfg *config) deviceFlags(fs *flag.FlagSet) {
	fs.BoolVar(&cfg.Enroll, "enroll", false, "pair this Edge with a signed-in Hub user and exit")
	fs.StringVar(&cfg.DeviceCredentialFile, "device-credential-file", getEnv("AGENTHUB_DEVICE_CREDENTIAL_FILE", ""), "absolute private file path for enrolled device credentials")
	fs.StringVar(&cfg.EnrollmentName, "enrollment-name", "", "device name shown during Hub pairing")
	fs.StringVar(&cfg.EnrollmentWorkspace, "enrollment-workspace", "", "local workspace to approve during pairing; must be allowlisted")
	fs.StringVar(&cfg.DeviceJournalPath, "device-journal-db", getEnv("AGENTHUB_DEVICE_JOURNAL_DB", ""), "absolute SQLite cancellation journal path; required for enrolled execution")
}

func (cfg *config) validateDeviceMode() error {
	if !cfg.Enroll && cfg.DeviceCredentialFile == "" {
		return nil
	}
	if !filepath.IsAbs(cfg.DeviceCredentialFile) {
		return errors.New("enrolled mode requires an absolute --device-credential-file")
	}
	if cfg.RemoteMode || cfg.Dev || cfg.HubJWTSecret != "" || cfg.HubToken != "" || cfg.HubRefreshToken != "" || cfg.HubMCPSyncURL != "" {
		return errors.New("enrolled mode requires protected loopback operation without Hub product tokens, JWT secrets or MCP sync")
	}
	if cfg.Enroll {
		if strings.TrimSpace(cfg.EnrollmentName) == "" {
			return errors.New("--enroll requires --enrollment-name")
		}
		if _, err := device.NewClient(cfg.HubURL, "", edgehttp.NewClient(30*time.Second)); err != nil {
			return err
		}
		workspace, err := device.Workspace(cfg.EnrollmentWorkspace, cfg.WorkspaceAllowlist)
		if err != nil {
			return err
		}
		cfg.EnrollmentWorkspace = workspace
		if _, err := os.Lstat(cfg.DeviceCredentialFile); !errors.Is(err, os.ErrNotExist) {
			return errors.New("enrollment credential destination must not exist")
		}
		return nil
	}
	if cfg.StoreBackend != "sqlite" || !filepath.IsAbs(cfg.StoreDB) || !filepath.IsAbs(cfg.DeviceJournalPath) || !filepath.IsAbs(cfg.EventLogPath) {
		return errors.New("enrolled execution requires --store-backend sqlite, absolute --store-db, --device-journal-db and --event-log-path")
	}
	if cfg.RunnerCommand != "" || cfg.RunnerProfile != "" || len(cfg.RuntimeManifests) > 0 || cfg.AnthropicSDKPath != "" || (cfg.AgentDefault != "" && cfg.AgentDefault != "openai-sdk") || (cfg.OpenAISDKPath != "" && cfg.OpenAISDKPath != "env") {
		return errors.New("enrolled execution only supports openai-sdk with operator-provided OPENAI_API_KEY")
	}
	if os.Getenv("OPENAI_API_KEY") == "" {
		return errors.New("enrolled execution requires a dedicated OPENAI_API_KEY")
	}
	credential, err := device.LoadCredential(cfg.DeviceCredentialFile, cfg.WorkspaceAllowlist)
	if err != nil {
		return err
	}
	if cfg.HubURL != "" && strings.TrimRight(cfg.HubURL, "/") != credential.HubURL {
		return errors.New("Hub URL differs from enrolled credential")
	}
	if _, err := device.NewClient(credential.HubURL, credential.Secret, edgehttp.NewClient(30*time.Second)); err != nil {
		return err
	}
	cfg.DeviceCredential = &credential
	cfg.HubURL = credential.HubURL
	cfg.HubToken = credential.Secret
	cfg.EdgeDeviceID = credential.DeviceID
	cfg.AgentDefault = "openai-sdk"
	cfg.OpenAISDKPath = "env"
	return nil
}

func enrollDevice(cfg config, out io.Writer) error {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	client, err := device.NewClient(cfg.HubURL, "", edgehttp.NewClient(30*time.Second))
	if err != nil {
		return err
	}
	deviceID := uuid.NewString()
	enrollment, err := client.Start(ctx, device.StartRequest{DeviceID: deviceID, Name: cfg.EnrollmentName, RuntimeID: "openai-sdk", WorkspaceRoot: cfg.EnrollmentWorkspace})
	if err != nil {
		return err
	}
	// No secret, provider configuration or raw server response is printed.
	fmt.Fprintf(out, "Open %s, sign in, and confirm the Edge pairing code: %s\n", cfg.HubURL, enrollment.UserCode)
	fmt.Fprintln(out, "Verify the device name, openai-sdk runtime and workspace before confirming. Waiting for approval...")
	ctx, deadlineCancel := context.WithDeadline(ctx, enrollment.ExpiresAt)
	defer deadlineCancel()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return errors.New("Edge pairing expired or cancelled; start a new enrollment")
		case <-ticker.C:
		}
		credential, pending, err := client.Exchange(ctx, enrollment)
		if err != nil {
			return err
		}
		if pending {
			continue
		}
		if credential.DeviceID != deviceID || credential.WorkspaceRoot != cfg.EnrollmentWorkspace || credential.RuntimeID != "openai-sdk" {
			return errors.New("approved enrollment scope differs from local request")
		}
		if err := device.SaveCredential(cfg.DeviceCredentialFile, credential); err != nil {
			return err
		}
		fmt.Fprintln(out, "Edge pairing complete. The private device credential has been saved; start enrolled execution with the same credential file and workspace allowlist.")
		return nil
	}
}
