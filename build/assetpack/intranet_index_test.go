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

func TestInternalIndexLoadsRetroStylesheet(t *testing.T) {
	input := "<head><link rel=\"stylesheet\" href=\"app.css\"></head>"
	got := string(internalIndex([]byte(input)))
	link := `<link rel="stylesheet" href="intranet-retro.css">`
	if strings.Count(got, link) != 1 || strings.Index(got, link) < strings.Index(got, `href="app.css"`) {
		t.Fatalf("intranet stylesheet is not loaded once after app.css: %s", got)
	}
}
