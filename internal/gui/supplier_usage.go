package gui

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/usage"
	"github.com/yetone/magpie/internal/usageapi"
)

type usageSupplier struct {
	ID        string   `json:"id"`
	Providers []string `json:"providers"`
}

func supplierUsageRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/usage/suppliers", coldTurn(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, configuredUsageSuppliers(provider.All()))
	}))
	mux.HandleFunc("GET /api/usage/suppliers/tig/keys", coldTurn(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, tigUsageProviders(provider.All()))
	}))
	mux.HandleFunc("GET /api/usage/suppliers/tig/key", coldTurn(func(w http.ResponseWriter, r *http.Request) {
		providerID, keyID := r.URL.Query().Get("provider"), r.URL.Query().Get("key")
		for _, p := range tigUsageProviders(provider.All()) {
			if p.Provider != providerID {
				continue
			}
			for _, key := range p.Keys {
				if key.ID == keyID {
					now := usage.Clock()
					windows, periods := tigUsagePeriods(now, key.Windows)
					writeJSON(w, tigUsageKey{windows, usage.TIGKeyUsageOf(now, providerID, keyID, periods)})
					return
				}
			}
		}
		http.NotFound(w, r)
	}))
	mux.HandleFunc("GET /api/usage/suppliers/{id}", coldTurn(func(w http.ResponseWriter, r *http.Request) {
		id, channel := r.PathValue("id"), r.URL.Query().Get("channel")
		if channel != "" && (id != "tig" || channel != "zp" && channel != "hs" && channel != "tc") {
			http.Error(w, "invalid supplier channel", http.StatusBadRequest)
			return
		}
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		for _, source := range configuredUsageSuppliers(provider.All()) {
			if source.ID != id {
				continue
			}
			ids := make(map[string]bool, len(source.Providers))
			for _, ref := range source.Providers {
				ids[ref] = true
			}
			writeJSON(w, usage.SupplierUsageOf(ids, channel, days, usageapi.ZoneOf(r)))
			return
		}
		http.NotFound(w, r)
	}))
}

type tigUsageKey struct {
	Windows []tigUsageWindow  `json:"windows"`
	Usage   usage.TIGKeyUsage `json:"usage"`
}

type tigUsageWindow struct {
	Period string    `json:"period"`
	Status string    `json:"status"`
	Start  time.Time `json:"start,omitzero"`
	Reset  time.Time `json:"reset,omitzero"`
}

func tigUsagePeriods(now time.Time, observations []gateway.TIGQuotaWindow) ([]tigUsageWindow, map[string]usage.TIGKeyPeriod) {
	windows := make([]tigUsageWindow, 0, len(observations))
	periods := make(map[string]usage.TIGKeyPeriod, len(observations))
	for _, o := range observations {
		w := tigUsageWindow{Period: o.Period, Status: "unknown"}
		duration := 7 * 24 * time.Hour
		if o.Period == "fiveHours" {
			duration = 5 * time.Hour
		}
		if o.Until.After(now) {
			w.Reset, w.Status = o.Until, "observed"
			if o.Estimated {
				w.Status = "estimated"
				w.Start = o.Until.Add(-duration)
				if !w.Start.After(now) && !w.Start.Before(o.ObservedAfter) {
					periods[o.Period] = usage.TIGKeyPeriod{From: w.Start}
				} else {
					w = tigUsageWindow{Period: o.Period, Status: "unknown"}
				}
			}
		} else if !o.Until.IsZero() {
			w.Status = "expired"
		}
		if _, ok := periods[o.Period]; !ok && o.Period == "fiveHours" {
			periods[o.Period] = usage.TIGKeyPeriod{From: now.Add(-duration), Rolling: true}
		}
		windows = append(windows, w)
	}
	return windows, periods
}

type tigUsageProvider struct {
	Provider string                `json:"provider"`
	Keys     []gateway.TIGKeyUsage `json:"keys"`
}

func tigUsageProviders(providers []provider.Provider) []tigUsageProvider {
	out := make([]tigUsageProvider, 0)
	for _, p := range providers {
		if !hasSupplierID(p, "aiep-coding-plan") && !hasSupplierID(p, "sub2agent-tigcodingplan") {
			continue
		}
		if keys := gateway.TIGKeyUsages(p); len(keys) > 0 {
			out = append(out, tigUsageProvider{Provider: p.ID, Keys: keys})
		}
	}
	return out
}

func configuredUsageSuppliers(providers []provider.Provider) []usageSupplier {
	suppliers := []usageSupplier{{ID: "tig"}, {ID: "cib"}, {ID: "workbuddy-enterprise"}, {ID: "workbuddy-cib"}}
	for _, p := range providers {
		if p.Key == "" && p.Account == nil && len(p.KeyList()) == 0 {
			continue
		}
		switch {
		case hasSupplierID(p, "aiep-coding-plan"), hasSupplierID(p, "sub2agent-tigcodingplan"):
			suppliers[0].Providers = append(suppliers[0].Providers, p.ID)
		case hasSupplierID(p, "cib-zht-apikey"):
			suppliers[1].Providers = append(suppliers[1].Providers, p.ID)
		case hasSupplierID(p, "sub2agent-workbuddy-cib"):
			suppliers[3].Providers = append(suppliers[3].Providers, p.ID)
		case hasSupplierID(p, "sub2agent-workbuddy"):
			suppliers[2].Providers = append(suppliers[2].Providers, p.ID)
		}
	}
	configured := make([]usageSupplier, 0, len(suppliers))
	for _, source := range suppliers {
		if len(source.Providers) > 0 {
			configured = append(configured, source)
		}
	}
	return configured
}

func hasSupplierID(p provider.Provider, id string) bool {
	return p.Preset == id || p.ID == id || strings.HasPrefix(p.ID, id+"-") || strings.HasPrefix(p.ID, id+"#")
}
