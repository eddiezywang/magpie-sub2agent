//go:build intranet && embeddedbun

package plugin

import (
	"archive/zip"
	"bytes"
	_ "embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

//go:embed bun-runtime.zip
var embeddedBunArchive []byte

const embeddedBunAvailable = true

// Extract only the pinned executable to the private runtime cache. Never
// unpack archive-controlled paths or put runtime files beside the application.
func materializeEmbeddedBun() (string, error) {
	bunMu.Lock()
	defer bunMu.Unlock()
	target := internalBunCache()
	if bunDigest(target, internalBunSHA256) {
		return target, nil
	}
	z, err := zip.NewReader(bytes.NewReader(embeddedBunArchive), int64(len(embeddedBunArchive)))
	if err != nil {
		return "", err
	}
	for _, entry := range z.File {
		if entry.Name != "bun-windows-x64-baseline/bun.exe" {
			continue
		}
		if !entry.Mode().IsRegular() || entry.UncompressedSize64 > 120<<20 {
			break
		}
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return "", err
		}
		f, err := os.CreateTemp(filepath.Dir(target), ".embedded-bun-")
		if err != nil {
			return "", err
		}
		stage := f.Name()
		defer os.Remove(stage)
		r, err := entry.Open()
		if err != nil {
			f.Close()
			return "", err
		}
		_, copyErr := io.Copy(f, io.LimitReader(r, 120<<20))
		r.Close()
		closeErr := f.Close()
		if copyErr != nil || closeErr != nil || !bunDigest(stage, internalBunSHA256) {
			return "", fmt.Errorf("内嵌 Bun 完整性校验失败")
		}
		if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
			return "", err
		}
		if err := os.Rename(stage, target); err != nil {
			if bunDigest(target, internalBunSHA256) {
				return target, nil
			}
			return "", err
		}
		return target, nil
	}
	return "", fmt.Errorf("内嵌包缺少 Bun 运行时")
}
