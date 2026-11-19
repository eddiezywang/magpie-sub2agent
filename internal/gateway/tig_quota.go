package gateway

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/edit"
	"github.com/yetone/magpie/internal/lazyre"
	"github.com/yetone/magpie/internal/provider"
)

type TIGQuotaWindow struct {
	Period        string    `json:"period"`
	Until         time.Time `json:"until,omitzero"`
	Estimated     bool      `json:"estimated,omitempty"`
	ObservedAfter time.Time `json:"observedAfter,omitzero"`
}

var tigWindowMessage = lazyre.New(`已达到\s*(5|7)\s*(?:小时|天)(?:的)?使用上限[，,。\s]+(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\s*后可继续使用`)
var tigFiveHourWords = lazyre.New(`(?i)(?:5\s*小时|\b5\s*hours?\b)`)
var tigWeeklyWords = lazyre.New(`(?i)(?:7\s*天|周额度|周限额|\bweekly\b|\b7\s*days?\b)`)

var tigWindows struct {
	sync.Mutex
	path string
	data map[string]map[string]TIGQuotaWindow
}

func tigQuotaReset(body []byte, now time.Time) (string, time.Time) {
	match := tigWindowMessage.FindSubmatch(wordsOf(body))
	var period string
	var until time.Time
	if match != nil {
		period = "week"
		if string(match[1]) == "5" {
			period = "fiveHours"
		}
		parsed, err := time.ParseInLocation("2006-01-02 15:04:05", strings.ReplaceAll(string(match[2]), "T", " "), time.FixedZone("UTC+8", 8*3600))
		if err != nil {
			return "", time.Time{}
		}
		until = parsed
	} else {
		five, weekly := tigFiveHourWords.Match(wordsOf(body)), tigWeeklyWords.Match(wordsOf(body))
		if five == weekly {
			return "", time.Time{}
		}
		d := resetsZhipu(wordsOf(body), now)
		if d <= 0 {
			return "", time.Time{}
		}
		period = "week"
		if five {
			period = "fiveHours"
		}
		until = now.Add(d)
	}
	if !until.After(now) || until.After(now.Add(tigPeriod(period))) {
		return "", time.Time{}
	}
	return period, until
}

func tigPeriod(period string) time.Duration {
	if period == "fiveHours" {
		return 5 * time.Hour
	}
	return 7 * 24 * time.Hour
}

func tigProvider(p provider.Provider) bool {
	return p.Preset == "aiep-coding-plan" || p.Preset == "sub2agent-tigcodingplan" ||
		strings.HasPrefix(p.ID, "aiep-coding-plan") || strings.HasPrefix(p.ID, "sub2agent-tigcodingplan")
}

func tigQuotaKey(c candidate) string {
	_, channel := catalog.TIGModel(c.model)
	if !tigProvider(c.p) || channel != "zp" || c.p.Key == "" {
		return ""
	}
	return c.p.ID + "#" + provider.KeyID(c.p.Key) + "/zp"
}

func loadTIGWindows() {
	path := filepath.Join(filepath.Dir(provider.Path()), "tig-quota-windows.json")
	if tigWindows.path == path {
		return
	}
	tigWindows.path = path
	tigWindows.data = make(map[string]map[string]TIGQuotaWindow)
	if data, err := os.ReadFile(path); err == nil {
		var saved map[string]map[string]TIGQuotaWindow
		if json.Unmarshal(data, &saved) == nil && saved != nil {
			tigWindows.data = saved
		}
	}
}

func updateTIGWindows(key, period string, until, started time.Time) {
	tigWindows.Lock()
	defer tigWindows.Unlock()
	loadTIGWindows()
	windows := tigWindows.data[key]
	if period != "" {
		if windows == nil {
			windows = make(map[string]TIGQuotaWindow)
			tigWindows.data[key] = windows
		}
		windows[period] = TIGQuotaWindow{Period: period, Until: until}
	} else {
		changed := false
		for name, window := range windows {
			if !window.Until.IsZero() && !started.Before(window.Until) {
				windows[name] = TIGQuotaWindow{Period: name, Until: started.Add(tigPeriod(name)), Estimated: true, ObservedAfter: window.Until}
				changed = true
			} else if window.Estimated && !window.ObservedAfter.IsZero() &&
				!started.Before(window.ObservedAfter) && started.Before(window.Until.Add(-tigPeriod(name))) {
				window.Until = started.Add(tigPeriod(name))
				windows[name] = window
				changed = true
			}
		}
		if !changed {
			return
		}
	}
	data, err := json.Marshal(tigWindows.data)
	if err == nil {
		err = edit.WriteAtomic(tigWindows.path, data)
	}
	if err != nil {
		log.Printf("TIG quota windows: %v", err)
	}
}

func tigQuotaRest(c candidate, now time.Time) (Rest, bool) {
	key := tigQuotaKey(c)
	if key == "" {
		return Rest{}, false
	}
	tigWindows.Lock()
	defer tigWindows.Unlock()
	loadTIGWindows()
	var latest TIGQuotaWindow
	for _, w := range tigWindows.data[key] {
		if !w.Estimated && w.Until.After(now) && w.Until.After(latest.Until) {
			latest = w
		}
	}
	if latest.Period == "" {
		return Rest{}, false
	}
	return Rest{Why: failQuota, Status: 429, By: "resets", Until: latest.Until, Key: c.restKey(),
		QuotaPeriod: latest.Period, said: "TIG Coding Plan quota exhausted"}, true
}

func TIGQuotaWindows(p provider.Provider) []TIGQuotaWindow {
	keys := p.KeysOn()
	if !tigProvider(p) || len(keys) != 1 {
		return nil
	}
	tigWindows.Lock()
	defer tigWindows.Unlock()
	loadTIGWindows()
	return tigWindowsFor(p.ID, provider.KeyID(keys[0].Key))
}

// TIGKeyUsage identifies an enabled key using the same fingerprint as the
// gateway ledger and the persisted observations.
type TIGKeyUsage struct {
	ID      string           `json:"id"`
	Name    string           `json:"name,omitempty"`
	Windows []TIGQuotaWindow `json:"windows"`
}

func TIGKeyUsages(p provider.Provider) []TIGKeyUsage {
	if !tigProvider(p) {
		return nil
	}
	keys := p.KeysOn()
	tigWindows.Lock()
	defer tigWindows.Unlock()
	loadTIGWindows()
	out := make([]TIGKeyUsage, 0, len(keys))
	for _, key := range keys {
		id := provider.KeyID(key.Key)
		out = append(out, TIGKeyUsage{ID: id, Name: key.Name, Windows: tigWindowsFor(p.ID, id)})
	}
	return out
}

// tigWindowsFor reads under the caller's lock.
func tigWindowsFor(providerID, keyID string) []TIGQuotaWindow {
	windows := tigWindows.data[providerID+"#"+keyID+"/zp"]
	out := make([]TIGQuotaWindow, 0, 2)
	for _, period := range []string{"fiveHours", "week"} {
		window := windows[period]
		window.Period = period
		out = append(out, window)
	}
	return out
}
