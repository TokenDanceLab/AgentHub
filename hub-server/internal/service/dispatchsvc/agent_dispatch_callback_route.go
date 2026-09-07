package dispatchsvc

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/agenthub/hub-server/internal/service/dispatch"
)

// Direct execution requires a runtime that enforces callback ownership and has
// a configured callback path. A normal health response from an old Edge is not
// sufficient: it could accept work without anyone responsible for the result.
func (s *DispatchService) directCallbackRouteReady(ctx context.Context, parts dispatch.EdgeHTTPRequestParts) bool {
	deviceID := strings.TrimSpace(s.edgeCfg.DeviceID)
	if deviceID == "" {
		return false
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parts.EdgeURL+"/v1/health", nil)
	if err != nil {
		return false
	}
	request.Header = parts.Headers.Clone()
	response, err := s.edgeClient.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false
	}
	var health struct {
		EdgeID       string `json:"edgeId"`
		Capabilities struct {
			RunCallbackOwnership bool `json:"runCallbackOwnership"`
			DirectHubCallbacks   bool `json:"directHubCallbacks"`
		} `json:"capabilities"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, dispatch.EdgeHTTPResponseBodyLimit)).Decode(&health) != nil {
		return false
	}
	return health.EdgeID == deviceID && health.Capabilities.RunCallbackOwnership && health.Capabilities.DirectHubCallbacks
}

func edgeDispatchReceiptOwner(body []byte) string {
	var response struct {
		Data struct {
			CallbackOwner string `json:"callbackOwner"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &response) == nil {
		switch response.Data.CallbackOwner {
		case "edge", "desktop":
			return response.Data.CallbackOwner
		}
	}
	return ""
}
