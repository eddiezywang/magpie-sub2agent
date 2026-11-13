package main

import (
	"strings"
	"testing"
)

func TestInternalIndexProductBrand(t *testing.T) {
	out := string(internalIndex([]byte("<title>magpie</title>\n<span class=\"logo\">old</span>\n<span>magpie</span>\n</head>")))
	for _, want := range []string{"<title>sub2agent</title>", "<span>sub2agent</span>", "icons/sub2agent.svg"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing product brand: %s", want)
		}
	}
	if strings.Contains(out, "magpie") {
		t.Fatal("old brand remains in packed product index")
	}
}
