package accounting

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// reportSigningKey is injected into the distribution at build time. It is
// never sent to the browser or printed; it is not a per-user credential.
var reportSigningKey string
var reportDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// SignBillingRequest signs the exact request target. Each request uses a fresh
// nonce so retries must be signed again.
func SignBillingRequest(r *http.Request, key string, now time.Time) error {
	k, err := hex.DecodeString(key)
	if err != nil || len(k) != 32 || r.Method != http.MethodGet {
		return fmt.Errorf("billing signing unavailable")
	}
	var n [16]byte
	if _, err = rand.Read(n[:]); err != nil {
		return err
	}
	ts := fmt.Sprint(now.UnixMilli())
	nonce := hex.EncodeToString(n[:])
	text := "sub2agent-billing-v1\n" + r.Method + "\n" + r.URL.RequestURI() + "\n" + ts + "\n" + nonce
	mac := hmac.New(sha256.New, k)
	_, _ = mac.Write([]byte(text))
	r.Header.Set("X-Sub2Agent-Timestamp", ts)
	r.Header.Set("X-Sub2Agent-Nonce", nonce)
	r.Header.Set("X-Sub2Agent-Signature", hex.EncodeToString(mac.Sum(nil)))
	return nil
}

// BillingReport fetches the current OS user's report through the fixed managed
// service; the secret and upstream signature never go to the frontend.
func BillingReport(ctx context.Context, period, format, date string) ([]byte, string, error) {
	if period != "daily" && period != "weekly" {
		return nil, "", fmt.Errorf("invalid billing period")
	}
	if format != "json" && format != "svg" && format != "png" {
		return nil, "", fmt.Errorf("invalid billing format")
	}
	if date != "" {
		if !reportDate.MatchString(date) {
			return nil, "", fmt.Errorf("invalid date")
		}
		if _, err := time.Parse("2006-01-02", date); err != nil {
			return nil, "", fmt.Errorf("invalid date")
		}
	}
	username := strings.TrimSpace(os.Getenv("USERNAME"))
	if username == "" {
		username = strings.TrimSpace(os.Getenv("USER"))
	}
	if username == "" || strings.EqualFold(username, "unknown") || username == "." || username == ".." || strings.ContainsAny(username, "/\\") {
		return nil, "", fmt.Errorf("billing username unavailable")
	}
	u, err := endpoint(Defaults().UsageURL)
	if err != nil {
		return nil, "", err
	}
	u.Path = "/reports/" + username + "/" + period + "." + format
	if date != "" {
		u.RawQuery = url.Values{"date": {date}}.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "", err
	}
	if err = SignBillingRequest(req, reportSigningKey, time.Now()); err != nil {
		return nil, "", err
	}
	c := http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := c.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("billing service unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("billing service HTTP %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 8<<20+1))
	if err != nil || len(data) > 8<<20 {
		return nil, "", fmt.Errorf("invalid billing response")
	}
	kinds := map[string]string{"json": "application/json; charset=utf-8", "svg": "image/svg+xml", "png": "image/png"}
	return data, kinds[format], nil
}
