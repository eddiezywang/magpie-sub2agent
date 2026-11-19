package gui

import (
	"net/http"
	"strconv"
	"strings"

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
