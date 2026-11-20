//go:build intranet

package main

import "testing"

func TestIntranetDefaultVersion(t *testing.T) {
	if version != "1.0.0-beta.13" {
		t.Fatalf("intranet default version = %q, want 1.0.0-beta.13", version)
	}
}
