package api

// Residual pure-helper peel #1133: cc-switch catalog pure helpers extracted
// from model_catalog.go. Same package api; zero behavior change.

import (
	"path/filepath"
	"strings"

	"github.com/agenthub/edge-server/internal/ccswitch"
)

func addCcSwitchCatalog(builder *modelCatalogBuilder, ccSwitchHome string) {
	path := filepath.Join(ccSwitchHome, "settings.json")
	raw, err := readJSONFile(path)
	if err != nil {
		builder.addSource(modelCatalogSource{
			ID:     "cc-switch",
			Label:  "cc-switch",
			Status: "unavailable",
			Detail: "No readable cc-switch settings found.",
		})
		return
	}
	configured := 0
	for _, key := range []string{"currentProviderClaude", "currentProviderClaudeDesktop", "currentProviderCodex"} {
		if stringValue(raw[key]) != "" {
			configured++
		}
	}
	status := "unavailable"
	detail := "No active provider selection found."
	if configured > 0 {
		status = "configured"
		detail = "Provider selections are configured; provider IDs are redacted from the catalog."
	}
	builder.addSource(modelCatalogSource{
		ID:     "cc-switch",
		Label:  "cc-switch",
		Status: status,
		Detail: detail,
	})
}

// addCcSwitchDBCatalog enriches the model catalog with data read directly from
// the cc-switch SQLite database, providing the real model aliases (transparent
// proxy mappings) for the currently active provider.
func addCcSwitchDBCatalog(builder *modelCatalogBuilder, reader *ccswitch.Reader, status *ccswitch.CCSwitchStatus) {
	if status == nil || !status.Installed {
		builder.addSource(modelCatalogSource{
			ID:     "cc-switch-db",
			Label:  "cc-switch (database)",
			Status: "unavailable",
			Detail: "cc-switch is not installed on this machine.",
		})
		return
	}

	appTypes := status.ActiveAppTypes
	if len(appTypes) == 0 {
		appTypes = []string{"claude"}
	}

	routingLabel := "inactive"
	if status.RoutingActive {
		routingLabel = "active"
	}
	builder.addSource(modelCatalogSource{
		ID:     "cc-switch-db",
		Label:  "cc-switch (database)",
		Status: "ready",
		Detail: "Transparent proxy model aliases read from cc-switch database. Routing: " + routingLabel + ".",
	})

	for _, appType := range appTypes {
		providers, err := reader.ReadProviders(appType)
		if err != nil {
			continue
		}

		for _, p := range providers {
			if !p.IsCurrent {
				continue
			}

			host := hostFromURL(p.BaseURL)

			for alias, resolvedModel := range p.ModelAliases {
				if strings.HasSuffix(alias, "_name") {
					continue
				}

				label := alias
				if name, ok := p.ModelAliases[alias+"_name"]; ok {
					label = name
				}

				builder.addItem(modelCatalogItem{
					ID:            "cc-switch-db:" + appType + ":" + p.ProviderID + ":" + alias,
					Value:         alias,
					Label:         label,
					Provider:      p.ProviderName,
					RuntimeID:     runtimeIDForAppType(appType),
					ResolvedModel: resolvedModel,
					SourceID:      "cc-switch-db",
					SourceLabel:   "cc-switch (database)",
					Status:        "active",
					Description:   "Transparent proxy via " + p.ProviderName + hostDetail(host),
					Tags:          []string{"cc-switch", "transparent-proxy", appType},
				})
			}
		}
	}
}

// runtimeIDForAppType maps cc-switch app_type to edge-server runtime ID.
func runtimeIDForAppType(appType string) string {
	switch appType {
	case "claude", "claude-desktop":
		return "claude-code"
	case "codex":
		return "codex"
	case "gemini":
		return "opencode"
	default:
		return appType
	}
}
