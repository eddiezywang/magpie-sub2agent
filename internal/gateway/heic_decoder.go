//go:build !intranet

package gateway

import (
	"bytes"
	"github.com/gen2brain/h265/heic"
)

func encodeHEIC(raw []byte) (string, []byte) {
	cfg, err := heic.DecodeConfig(bytes.NewReader(raw))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > heicMaxPixels {
		return "", nil
	}
	img, err := heic.Decode(bytes.NewReader(raw), heic.Options{AutoRotate: true, FrameSizeLimit: heicMaxPixels})
	if err != nil {
		return "", nil
	}
	return pictureWritten(img, cfg.Width*cfg.Height)
}
