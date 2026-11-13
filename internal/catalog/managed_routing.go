package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/filememo"
)

var managedRoutingURL = "http://172.21.0.177:17890/usage/routing-catalog"

type managedRouting struct {
	Revision string        `json:"revision"`
	Expires  time.Time     `json:"expires_at"`
	Models   []managedRate `json:"models"`
}
type managedRate struct {
	Provider string    `json:"provider"`
	Model    string    `json:"model"`
	Score    float64   `json:"score"`
	Until    time.Time `json:"valid_until,omitempty"`
}

func managedRoutingPath() string { return appdir.Join(appdir.Cache(), "routing-catalog.json") }
func parseManagedRouting(raw []byte) (managedRouting, error) {
	var d managedRouting
	if err := json.Unmarshal(raw, &d); err != nil {
		return d, err
	}
	if d.Revision == "" || d.Expires.IsZero() || len(d.Models) > 4096 {
		return d, fmt.Errorf("invalid managed routing catalog")
	}
	for _, r := range d.Models {
		if r.Provider == "" || r.Model == "" || math.IsNaN(r.Score) || math.IsInf(r.Score, 0) || r.Score < 0 || strings.Contains(strings.TrimSuffix(r.Provider, "*"), "*") || strings.Contains(strings.TrimSuffix(r.Model, "*"), "*") {
			return d, fmt.Errorf("invalid managed rate")
		}
	}
	return d, nil
}
func routingModel(id string) string {
	id = strings.ToLower(id[strings.LastIndexByte(id, '/')+1:])
	if i := strings.LastIndex(id, "-maas-"); i > 0 && i+6 < len(id) {
		return id[:i] + "-maas"
	}
	if strings.HasSuffix(id, "-maas") {
		return id
	}
	return DeploymentModel(id)
}
func routingMatch(pattern, value string) bool {
	if p, ok := strings.CutSuffix(pattern, "*"); ok {
		return strings.HasPrefix(value, p)
	}
	return pattern == value
}

// RoutingScore is a relative scheduling weight, never a dollar price or a
// balance claim. The server owns coefficients and promotion lifetime.
func RoutingScore(provider, model string) (float64, bool) {
	if !distribution.Internal {
		return 0, false
	}
	d, err := filememo.Read("managed-routing", managedRoutingPath(), parseManagedRouting)
	if err != nil || !time.Now().Before(d.Expires) {
		return 0, false
	}
	for _, r := range d.Models {
		if !r.Until.IsZero() && !time.Now().Before(r.Until) {
			continue
		}
		if routingMatch(r.Provider, provider) && routingMatch(routingModel(r.Model), routingModel(model)) {
			return r.Score, true
		}
	}
	return 0, false
}
func refreshManagedRouting(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", managedRoutingURL, nil)
	if err != nil {
		return err
	}
	client := http.Client{Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("managed routing service unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("managed routing HTTP %d", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20+1))
	if err != nil || len(raw) > 1<<20 {
		return fmt.Errorf("invalid managed catalog size")
	}
	if _, err = parseManagedRouting(raw); err != nil {
		return err
	}
	target := managedRoutingPath()
	if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(target), ".routing-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(raw); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(f.Name(), target); err != nil {
		return err
	}
	Reset()
	return nil
}
