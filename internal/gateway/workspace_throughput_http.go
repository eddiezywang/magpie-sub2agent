package gateway

import (
	"context"
	"encoding/json"
	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/provider"
	"io"
	"net/http"
	"time"
)

func (s *Server) throughputRoutes(mux *routeMux) {
	if !distribution.Internal {
		return
	}
	mux.HandleFunc("GET /v1/magpie/throughput", func(w http.ResponseWriter, r *http.Request) {
		if !local(r) {
			writeError(w, provider.Chat, http.StatusForbidden, "throughput is available to this computer alone")
			return
		}
		if refuseHeld(w, r, heldRefused) {
			return
		}
		writeJSON(w, http.StatusOK, s.Throughput())
	})
}

// OwnerThroughput follows the same loopback owner boundary as OwnerTrace.
// Unsupported peers are unavailable, never silently reported as idle.
func OwnerThroughput(ctx context.Context) (ThroughputState, bool) {
	base := ownerURL()
	if base == "" {
		return ThroughputState{}, false
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/v1/magpie/throughput", nil)
	if err != nil {
		return ThroughputState{}, false
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return ThroughputState{}, false
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return ThroughputState{}, false
	}
	var out ThroughputState
	if json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&out) != nil || out.Version != 1 || out.WindowSeconds != 180 || len(out.Total.Points) != 180 || out.Epoch == 0 {
		return ThroughputState{}, false
	}
	return out, true
}
