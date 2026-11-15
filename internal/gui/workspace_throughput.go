package gui

import (
	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/gateway"
	"net/http"
)

func workspaceThroughputRoutes(mux *http.ServeMux) {
	if !distribution.Internal {
		return
	}
	mux.HandleFunc("GET /api/gateway/throughput", func(w http.ResponseWriter, r *http.Request) {
		if gw := served.Load(); gw != nil {
			writeJSON(w, gw.Throughput())
			return
		}
		if out, ok := gateway.OwnerThroughput(r.Context()); ok {
			writeJSON(w, out)
			return
		}
		writeJSON(w, map[string]any{"version": 1, "status": "unavailable", "reason": "Gateway throughput is unavailable"})
	})
}
