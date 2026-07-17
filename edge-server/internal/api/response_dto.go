package api

func listResponse(items any) map[string]any {
	return map[string]any{
		"items": items,
		"page": map[string]any{
			"hasMore": false,
		},
	}
}

func acceptedResponse(data map[string]any) map[string]any {
	return data
}
