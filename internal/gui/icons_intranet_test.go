//go:build !nogui && intranet

package gui

import (
	"bytes"
	"encoding/binary"
	"image/png"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// The EXE resource frames and runtime tray must use the same pixel artwork.
func TestInternalNativeBrand(t *testing.T) {
	if binary.LittleEndian.Uint16(winTrayIcon[4:]) != 9 {
		t.Fatal("missing native icon sizes")
	}
	for i, size := range []int{16, 20, 24, 32, 40, 48, 64, 128, 256} {
		e := winTrayIcon[6+i*16:]
		n, offset := binary.LittleEndian.Uint32(e[8:]), binary.LittleEndian.Uint32(e[12:])
		frame := winTrayIcon[offset : offset+n]
		file, err := os.ReadFile(filepath.Join("pixelbrand", "icon-"+strconv.Itoa(size)+".png"))
		if err != nil || !bytes.Equal(frame, file) {
			t.Fatalf("%dpx resource/tray mismatch: %v", size, err)
		}
		img, err := png.Decode(bytes.NewReader(frame))
		if err != nil || img.Bounds().Dx() != size {
			t.Fatalf("invalid %dpx frame: %v", size, err)
		}
		blue := false
		for y := 0; y < size; y++ {
			for x := 0; x < size; x++ {
				r, g, b, a := img.At(x, y).RGBA()
				if a != 0 && a != 0xffff && a != 92*257 {
					t.Fatalf("%dpx frame has blurred edge", size)
				}
				blue = blue || (b > r && b > g && a == 0xffff)
			}
		}
		if !blue {
			t.Fatalf("%dpx mark lost its blue palette", size)
		}
	}
}
