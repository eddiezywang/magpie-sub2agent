//go:build intranet

package main

import "testing"

func TestIntranetDefaultVersion(t *testing.T) {
	if version != "0.6.0" {
		t.Fatalf("intranet default version = %q, want 0.6.0", version)
	}
}
