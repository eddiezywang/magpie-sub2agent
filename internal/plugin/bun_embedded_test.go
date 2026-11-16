//go:build intranet && embeddedbun

package plugin

import (
	"os"
	"testing"
)

func TestEmbeddedBunWorksWithEmptyCache(t *testing.T) {
	storeSandbox(t)
	target, err := materializeEmbeddedBun()
	if err != nil {
		t.Fatal(err)
	}
	if !bunDigest(target, internalBunSHA256) {
		t.Fatal("runtime digest mismatch")
	}
	before, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	again, err := materializeEmbeddedBun()
	if err != nil || again != target {
		t.Fatal("cached runtime not reused", err)
	}
	after, err := os.Stat(target)
	if err != nil || !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("runtime rewritten on repeated read")
	}
}
