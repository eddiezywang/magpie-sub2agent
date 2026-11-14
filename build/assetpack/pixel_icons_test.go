package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// Every shipped brand must have an overlay, including PNG callers. A missing
// replacement must fail the build rather than silently mixing two icon styles.
func TestPixelBrandCoverage(t *testing.T) {
	root := filepath.Join("..", "..")
	entries, err := os.ReadDir(filepath.Join(root, "internal", "gui", "assets", "icons"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		b, err := os.ReadFile(filepath.Join(root, "build", "intranet", "pixel-icons", entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if filepath.Ext(entry.Name()) == ".svg" && !bytes.Contains(b, []byte(`shape-rendering="crispEdges"`)) {
			t.Errorf("%s is not a pixel SVG", entry.Name())
		}
	}
}
