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
	mux.HandleFunc("POST /api/legacy-suppliers/import", func(w http.ResponseWriter, r *http.Request) {
		count, err := provider.ImportSub2AgentAuth()
		result := map[string]any{"imported": count}
		if err != nil {
			result["error"] = err.Error()
		}
		preview, previewErr := provider.LegacySub2AgentPreview()
		if previewErr != nil {
			result["error"] = previewErr.Error()
		} else {
			result["preview"] = preview
		}
		writeJSON(w, result)
	})
	mux.HandleFunc("POST /api/legacy-suppliers/dismiss", func(w http.ResponseWriter, r *http.Request) {
		if err := provider.DismissLegacySub2AgentImport(); err != nil {
			http.Error(w, "无法保存导入提示状态", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
}
