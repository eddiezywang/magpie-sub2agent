// Export the server's offline list prices through the same MakerPrice lookup
// used by the desktop. No live configuration or network is read.
package main

import (
	"compress/gzip"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/provider"
)

func main() {
	input := flag.String("catalog", "internal/catalog/bundled/api.json.gz", "bundled catalog")
	output := flag.String("out", "services/usage-server/src/catalog-prices.json", "output snapshot")
	flag.Parse()
	b, err := os.ReadFile(*input)
	must(err)
	r, err := gzip.NewReader(strings.NewReader(string(b)))
	must(err)
	raw, err := io.ReadAll(r)
	must(err)
	must(r.Close())
	var all map[string]struct {
		Models map[string]struct {
			Canonical string `json:"canonical_model_id"`
		} `json:"models"`
	}
	must(json.Unmarshal(raw, &all))
	tmp, err := os.MkdirTemp("", "usage-price-export-")
	must(err)
	defer os.RemoveAll(tmp)
	must(os.WriteFile(filepath.Join(tmp, ".portable"), nil, 0600))
	appdir.UseExecutable(filepath.Join(tmp, "export.exe"))
	must(os.MkdirAll(filepath.Dir(catalog.CachePath()), 0700))
	must(os.WriteFile(catalog.CachePath(), raw, 0600))
	catalog.Reset()
	models := map[string]catalog.Price{}
	for _, p := range all {
		for id, m := range p.Models {
			for _, name := range []string{id, m.Canonical} {
				if name == "" {
					continue
				}
				if price, ok := provider.MakerPrice(name); ok {
					catalog.OneHourFor(name, &price)
					models[strings.ToLower(name)] = price
				}
			}
		}
	}
	peakDays := map[catalog.Peak][]string{}
	for _, peak := range []catalog.Peak{catalog.PeakDeepSeek, catalog.PeakWeekdays, catalog.PeakOllama} {
		for d := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC); d.Year() <= 2027; d = d.AddDate(0, 0, 1) {
			hour := 1
			if peak == catalog.PeakOllama {
				hour = 12
			}
			if peak.At(d.Add(time.Duration(hour) * time.Hour)) {
				peakDays[peak] = append(peakDays[peak], d.Format("2006-01-02"))
			}
		}
	}
	result := struct {
		Source   string                    `json:"source"`
		SHA      string                    `json:"catalog_sha256"`
		Models   map[string]catalog.Price  `json:"models"`
		PeakDays map[catalog.Peak][]string `json:"peak_days"`
	}{"catalog.MakerPriced via provider.MakerPrice", fmt.Sprintf("%x", sha256.Sum256(b)), models, peakDays}
	data, err := json.Marshal(result)
	must(err)
	must(os.WriteFile(*output, append(data, '\n'), 0644))
	fmt.Printf("Exported %d model spellings\n", len(models))
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
