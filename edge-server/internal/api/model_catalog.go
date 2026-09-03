package api

// model_catalog.go holds the model-catalog HTTP entry, adapter mapping surface,
// and catalog builder. Residual pure-helper peel #1133 moved source-specific
// and shared pure helpers into model_catalog_*.go companions.
// Zero behavior change — pure move only.

import (
	"net/http"
	"sort"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/errcode"
)

type modelCatalogResponse struct {
	Items   []modelCatalogItem   `json:"items"`
	Sources []modelCatalogSource `json:"sources"`
}

type modelCatalogItem struct {
	ID               string   `json:"id"`
	Value            string   `json:"value"`
	Label            string   `json:"label"`
	Provider         string   `json:"provider,omitempty"`
	RuntimeID        string   `json:"runtimeId,omitempty"`
	ResolvedModel    string   `json:"resolvedModel,omitempty"`
	SourceID         string   `json:"sourceId"`
	SourceLabel      string   `json:"sourceLabel"`
	Status           string   `json:"status"`
	Description      string   `json:"description,omitempty"`
	Tags             []string `json:"tags,omitempty"`
	ReasoningEfforts []string `json:"reasoningEfforts,omitempty"`
	Default          bool     `json:"default,omitempty"`
}

type modelCatalogSource struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

func (h *Handler) GetModelCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errcode.Write(w, errcode.ErrMethodNotAllowed)
		return
	}
	writeSuccess(w, http.StatusOK, h.buildModelCatalog())
}

func (h *Handler) buildModelCatalog() modelCatalogResponse {
	builder := &modelCatalogBuilder{
		itemsByID:   map[string]modelCatalogItem{},
		sourcesByID: map[string]modelCatalogSource{},
	}
	builder.addSource(modelCatalogSource{
		ID:     "edge-adapter",
		Label:  "Edge adapter mappings",
		Status: "ready",
		Detail: "Runtime alias mappings compiled into the local Edge adapter layer.",
	})
	h.addAdapterModelCatalog(builder)
	addLocalConfigModelCatalog(builder)
	if h.CCSwitchReader != nil {
		addCcSwitchDBCatalog(builder, h.CCSwitchReader, h.CCSwitchStatus)
	}
	return builder.response()
}

func (h *Handler) addAdapterModelCatalog(builder *modelCatalogBuilder) {
	runtimeIDs := make([]string, 0, len(adapters.ModelAliases))
	for runtimeID := range adapters.ModelAliases {
		runtimeIDs = append(runtimeIDs, runtimeID)
	}
	for runtimeID := range adapters.DefaultModels {
		if _, ok := adapters.ModelAliases[runtimeID]; !ok {
			runtimeIDs = append(runtimeIDs, runtimeID)
		}
	}
	sort.Strings(runtimeIDs)

	for _, runtimeID := range runtimeIDs {
		status := h.adapterModelStatus(runtimeID)
		provider := runtimeProviderLabel(runtimeID)
		efforts := reasoningEffortsForRuntime(runtimeID)
		aliases := adapters.ModelAliases[runtimeID]
		aliasNames := make([]string, 0, len(aliases))
		for alias := range aliases {
			aliasNames = append(aliasNames, alias)
		}
		sort.Strings(aliasNames)
		for _, alias := range aliasNames {
			resolved := aliases[alias]
			builder.addItem(modelCatalogItem{
				ID:               "edge-adapter:" + runtimeID + ":" + alias,
				Value:            alias,
				Label:            alias,
				Provider:         provider,
				RuntimeID:        runtimeID,
				ResolvedModel:    resolved,
				SourceID:         "edge-adapter",
				SourceLabel:      "Edge adapter mappings",
				Status:           status,
				Description:      "Resolved by local Edge before launching the runtime.",
				Tags:             []string{"alias", runtimeID},
				ReasoningEfforts: efforts,
			})
		}
		if defaultModel := adapters.DefaultModels[runtimeID]; defaultModel != "" {
			builder.addItem(modelCatalogItem{
				ID:               "edge-adapter:" + runtimeID + ":default",
				Value:            defaultModel,
				Label:            defaultModel,
				Provider:         provider,
				RuntimeID:        runtimeID,
				ResolvedModel:    defaultModel,
				SourceID:         "edge-adapter",
				SourceLabel:      "Edge adapter mappings",
				Status:           status,
				Description:      "Default model compiled into the local Edge adapter.",
				Tags:             []string{"default", runtimeID},
				ReasoningEfforts: efforts,
				Default:          true,
			})
		}
	}
}

func (h *Handler) adapterModelStatus(runtimeID string) string {
	if h.AdapterRegistry == nil {
		return "configured"
	}
	adapter, ok := h.AdapterRegistry.Get(runtimeID)
	if !ok {
		return "configured"
	}
	if adapter.Available() {
		return "available"
	}
	return "unavailable"
}

type modelCatalogBuilder struct {
	itemsByID   map[string]modelCatalogItem
	sourcesByID map[string]modelCatalogSource
}

func (b *modelCatalogBuilder) addSource(source modelCatalogSource) {
	if source.ID == "" {
		return
	}
	b.sourcesByID[source.ID] = source
}

func (b *modelCatalogBuilder) addItem(item modelCatalogItem) {
	if item.ID == "" || item.Value == "" {
		return
	}
	if item.Label == "" {
		item.Label = item.Value
	}
	b.itemsByID[item.ID] = item
}

func (b *modelCatalogBuilder) response() modelCatalogResponse {
	items := make([]modelCatalogItem, 0, len(b.itemsByID))
	for _, item := range b.itemsByID {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].RuntimeID != items[j].RuntimeID {
			return items[i].RuntimeID < items[j].RuntimeID
		}
		if items[i].SourceID != items[j].SourceID {
			return items[i].SourceID < items[j].SourceID
		}
		return items[i].Label < items[j].Label
	})

	sources := make([]modelCatalogSource, 0, len(b.sourcesByID))
	for _, source := range b.sourcesByID {
		sources = append(sources, source)
	}
	sort.Slice(sources, func(i, j int) bool {
		return sources[i].ID < sources[j].ID
	})
	return modelCatalogResponse{Items: items, Sources: sources}
}
