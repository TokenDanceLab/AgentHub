package service

import (
	"encoding/json"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"mime"
	"os"
)

// ExtractImageMetadataJSON returns normalized attachment metadata for images.
// Non-image content keeps the current empty metadata object.
func ExtractImageMetadataJSON(filePath, contentType string) (string, error) {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType == "" || len(mediaType) < len("image/") || mediaType[:len("image/")] != "image/" {
		return "{}", nil
	}

	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	cfg, _, err := image.DecodeConfig(file)
	if err != nil {
		return "{}", nil
	}

	metadata, err := json.Marshal(map[string]int{
		"width":  cfg.Width,
		"height": cfg.Height,
	})
	if err != nil {
		return "", err
	}
	return string(metadata), nil
}
