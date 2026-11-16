package gui

import (
	"net/http"

	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/provider"
)

func legacySupplierPreviewRoutes(mux *http.ServeMux) {
	if !distribution.Internal {
		return
	}
	mux.HandleFunc("GET /api/legacy-suppliers", func(w http.ResponseWriter, r *http.Request) {
		preview, err := provider.LegacySub2AgentPreview()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, preview)
	})
}
