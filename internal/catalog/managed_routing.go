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
	Revision  string          `json:"revision"`
	Effective time.Time       `json:"effective_at"`
	Expires   time.Time       `json:"expires_at"`
	Models    []managedRate   `json:"models"`
	TIGPlans  json.RawMessage `json:"tig_plans,omitempty"`
	TIGPeak   *tigPeak        `json:"tig_peak,omitempty"`
}

// ManagedTIGPlans returns the unexpired server-managed reference configuration.
func ManagedTIGPlans() (map[string]any, error) {
	d, err := filememo.Read("managed-routing", managedRoutingPath(), parseManagedRouting)
	if err != nil || !time.Now().Before(d.Expires) || len(d.TIGPlans) == 0 || string(d.TIGPlans) == "null" {
		return nil, fmt.Errorf("TIG plan configuration unavailable")
	}
	var plans any
	if err := json.Unmarshal(d.TIGPlans, &plans); err != nil {
		return nil, err
	}
	rates := make([]managedRate, 0)
	for _, rate := range d.Models {
		if rate.Deployment == "zp" || rate.Deployment == "hs" || rate.Deployment == "tc" {
			rates = append(rates, rate)
		}
	}
	return map[string]any{"config": plans, "rates": rates, "revision": d.Revision, "effectiveAt": d.Effective, "peak": d.TIGPeak}, nil
}

// ManagedMaaSRates returns the active WorkBuddy enterprise reference rates
// applicable to the configured provider ids.
func ManagedMaaSRates(providers []string) (map[string]any, error) {
	d, err := filememo.Read("managed-routing", managedRoutingPath(), parseManagedRouting)
	now := time.Now()
	if err != nil || !now.Before(d.Expires) {
		return nil, fmt.Errorf("MaaS rates unavailable")
	}
	rates := make([]managedRate, 0)
	for _, rate := range d.Models {
		if rate.Currency != "POINTS" || rate.Coefficient == nil || !strings.HasSuffix(strings.ToLower(rate.Model), "-maas") ||
			!rate.Until.IsZero() && !now.Before(rate.Until) {
			continue
		}
		for _, id := range providers {
			if routingMatch(rate.Provider, id) {
				rates = append(rates, rate)
				break
			}
		}
	}
	return map[string]any{"rates": rates, "revision": d.Revision}, nil
}

type creditRates struct {
	Input     float64 `json:"input"`
	CacheRead float64 `json:"cache_read"`
	Output    float64 `json:"output"`
}
type managedRate struct {
	Provider        string       `json:"provider"`
	Deployment      string       `json:"deployment,omitempty"`
	CreditRates     *creditRates `json:"credit_rates,omitempty"`
	Model           string       `json:"model"`
	Score           float64      `json:"score"`
	Until           time.Time    `json:"valid_until,omitempty"`
	Currency        string       `json:"currency,omitempty"`
	Coefficient     *float64     `json:"coefficient,omitempty"`
	Source          string       `json:"source,omitempty"`
	Pool            string       `json:"pool,omitempty"`
	ServiceTier     string       `json:"service_tier,omitempty"`
	Above           []int64      `json:"above,omitempty"`
	AfternoonFactor *float64     `json:"weekday_afternoon_factor,omitempty"`
}

// RoutingBilling keeps enterprise accounting distinct from USD list prices.
// Pool is empty until the upstream's shared allowance scope is established.
type RoutingBilling struct {
	Currency    string       `json:"currency,omitempty"`
	CreditRates *creditRates `json:"credit_rates,omitempty"`
	Coefficient *float64     `json:"coefficient,omitempty"`
	Source      string       `json:"source,omitempty"`
	Pool        string       `json:"pool,omitempty"`
	Revision    string       `json:"revision,omitempty"`
	State       string       `json:"state"`
	Score       float64      `json:"-"`
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
		if (r.Currency != "" && r.Currency != "POINTS" && r.Currency != "GLM_POINTS" && r.Currency != "TC_POINTS" && r.Currency != "VOLC_AFP" && r.Currency != "PLAN_TOKENS" && r.Currency != "USD") || (r.Coefficient != nil && (math.IsNaN(*r.Coefficient) || math.IsInf(*r.Coefficient, 0) || *r.Coefficient < 0)) || (r.Coefficient != nil && r.Currency == "") {
			return d, fmt.Errorf("invalid routing billing")
		}
		if (r.Deployment != "" && r.Deployment != "zp" && r.Deployment != "tc" && r.Deployment != "hs") || (r.CreditRates != nil && (r.Currency != "GLM_POINTS" || r.CreditRates.Input < 0 || r.CreditRates.CacheRead < 0 || r.CreditRates.Output < 0 || math.IsNaN(r.CreditRates.Input) || math.IsNaN(r.CreditRates.CacheRead) || math.IsNaN(r.CreditRates.Output) || math.IsInf(r.CreditRates.Input, 0) || math.IsInf(r.CreditRates.CacheRead, 0) || math.IsInf(r.CreditRates.Output, 0))) {
			return d, fmt.Errorf("invalid credit rates")
		}
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
	b := RoutingBillingOf(provider, model)
	return b.Score, b.State == "active"
}

func RoutingBillingOf(provider, model string) RoutingBilling {
	unknown := RoutingBilling{State: "unknown"}
	if !distribution.Internal {
		return unknown
	}
	d, err := filememo.Read("managed-routing", managedRoutingPath(), parseManagedRouting)
	if err != nil {
		return unknown
	}
	// Exact model rules beat wildcard defaults, regardless of document order.
	best := -1
	var matched *managedRate
	for _, r := range d.Models {
		bare := strings.ToLower(model[strings.LastIndexByte(model, '/')+1:])
		dep := ""
		for _, pair := range []struct{ suffix, channel string }{{"-zp", "zp"}, {"-zp-openai", "zp"}, {"-tc", "tc"}, {"-tc-openai", "tc"}, {"-hs", "hs"}, {"-hs-openai", "hs"}} {
			if strings.HasSuffix(bare, pair.suffix) {
				dep = pair.channel
				break
			}
		}
		tig := strings.HasPrefix(provider, "sub2agent-tigcodingplan") || strings.HasPrefix(provider, "aiep-coding-plan")
		if r.Deployment != "" && r.Deployment != dep || tig && dep != "" && r.Deployment != dep {
			continue
		}
		if routingMatch(r.Provider, provider) && routingMatch(routingModel(r.Model), routingModel(model)) {
			specificity := len(strings.TrimSuffix(r.Provider, "*")) + len(strings.TrimSuffix(r.Model, "*"))
			if !strings.HasSuffix(r.Model, "*") {
				specificity += 10000
			}
			if specificity > best {
				copy := r
				matched = &copy
				best = specificity
			}
		}
	}
	if matched == nil {
		return unknown
	}
	r := matched
	b := RoutingBilling{Currency: r.Currency, Coefficient: r.Coefficient, CreditRates: r.CreditRates, Source: r.Source, Pool: r.Pool, Revision: d.Revision, State: "active", Score: r.Score}
	if !time.Now().Before(d.Expires) || (!r.Until.IsZero() && !time.Now().Before(r.Until)) {
		b.State = "expired"
		b.Coefficient = nil
		b.CreditRates = nil
	}
	return b
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
