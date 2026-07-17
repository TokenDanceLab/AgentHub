package lifecycle

import (
	"fmt"
	"strings"

	"github.com/agenthub/edge-server/internal/runnerctx"
)

func errorWithRunOutput(err error, outStore *runnerctx.RunOutputStore) error {
	if err == nil || outStore == nil {
		return err
	}
	output, readErr := outStore.ReadAll()
	output = strings.TrimSpace(output)
	if readErr != nil || output == "" {
		return err
	}
	chunks := splitHubCallbackText(output, persistedFailureMessageMaxBytes)
	if len(chunks) == 0 {
		return err
	}
	message := chunks[0]
	if len(chunks) > 1 || len(output) > len(message) {
		message += "\n[output truncated]"
	}
	return fmt.Errorf("%w: %s", err, message)
}
