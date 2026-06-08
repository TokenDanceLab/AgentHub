package service_test

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/agenthub/hub-server/internal/service"
)

func TestExtractImageMetadataJSON_ReadsPNGDimensions(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 2, 3))
	img.Set(1, 2, color.RGBA{R: 255, A: 255})

	path := filepath.Join(t.TempDir(), "pixel.png")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatalf("Encode() error = %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	metadata, err := service.ExtractImageMetadataJSON(path, "image/png")
	if err != nil {
		t.Fatalf("ExtractImageMetadataJSON() error = %v", err)
	}
	if metadata != `{"height":3,"width":2}` {
		t.Fatalf("metadata = %q, want PNG dimensions", metadata)
	}
}

func TestExtractImageMetadataJSON_IgnoresNonImageContent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(path, []byte("hello"), 0644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	metadata, err := service.ExtractImageMetadataJSON(path, "text/plain")
	if err != nil {
		t.Fatalf("ExtractImageMetadataJSON() error = %v", err)
	}
	if metadata != "{}" {
		t.Fatalf("metadata = %q, want empty object for non-image content", metadata)
	}
}

func TestExtractImageMetadataJSON_IgnoresUnsupportedImageDecode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preview.webp")
	if err := os.WriteFile(path, []byte("RIFF\x12\x00\x00\x00WEBPVP8 "), 0644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	metadata, err := service.ExtractImageMetadataJSON(path, "image/webp")
	if err != nil {
		t.Fatalf("ExtractImageMetadataJSON() error = %v, want nil for unsupported image decode", err)
	}
	if metadata != "{}" {
		t.Fatalf("metadata = %q, want empty object for unsupported image decode", metadata)
	}
}
