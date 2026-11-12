package accounting

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"time"
)

type Sender struct {
	LegacyURL, UsageURL, Token string
	Client                     *http.Client
}

func endpoint(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, fmt.Errorf("invalid accounting endpoint")
	}
	return u, nil
}

func (s Sender) request(ctx context.Context, method, addr string, body []byte, result any) error {
	if _, err := endpoint(addr); err != nil {
		return err
	}
	r, err := http.NewRequestWithContext(ctx, method, addr, bytes.NewReader(body))
	if err != nil {
		return err
	}
	r.Header.Set("Content-Type", "application/json")
	if s.Token != "" {
		r.Header.Set("Authorization", "Bearer "+s.Token)
	}
	c := http.Client{Timeout: 3 * time.Second}
	if s.Client != nil {
		c = *s.Client
	}
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := c.Do(r)
	if err != nil {
		return fmt.Errorf("accounting transport failed")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("accounting HTTP %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 1<<20+1))
	if err != nil || len(data) > 1<<20 {
		return fmt.Errorf("invalid accounting response size")
	}
	if err := json.Unmarshal(data, result); err != nil {
		return fmt.Errorf("invalid accounting JSON response")
	}
	return nil
}

// Send only acknowledges explicit durable acceptance. Old legacy collectors
// use {ok:true}; v2 usage collectors must name every accepted/duplicate ID.
// Unsupported collectors leave usage queued, without affecting /events.
func (s Sender) Send(ctx context.Context, items []Item) ([]string, error) {
	if len(items) == 0 {
		return nil, nil
	}
	first := items[0]
	for _, it := range items {
		if it.Kind != first.Kind || it.Identity != first.Identity {
			return nil, fmt.Errorf("mixed accounting batch")
		}
	}
	if first.Kind == "legacy" {
		if len(items) != 1 {
			return nil, fmt.Errorf("legacy telemetry requires a single event")
		}
		var ack struct {
			OK bool `json:"ok"`
		}
		if err := s.request(ctx, "POST", s.LegacyURL, first.Payload, &ack); err != nil {
			return nil, err
		}
		if !ack.OK {
			return nil, fmt.Errorf("legacy event not acknowledged")
		}
		return []string{first.ID}, nil
	}
	if first.Kind != "usage" || len(items) > 200 {
		return nil, fmt.Errorf("invalid usage batch")
	}
	u, err := endpoint(s.UsageURL)
	if err != nil {
		return nil, err
	}
	u.Path = "/healthz"
	var capabilities struct {
		Schemas []string `json:"usage_schemas"`
	}
	if err = s.request(ctx, "GET", u.String(), nil, &capabilities); err != nil {
		return nil, err
	}
	if !slices.Contains(capabilities.Schemas, UsageSchema) {
		return nil, fmt.Errorf("collector does not advertise usage v2")
	}
	events := make([]json.RawMessage, 0, len(items))
	sent := map[string]bool{}
	for _, it := range items {
		events = append(events, it.Payload)
		sent[it.ID] = true
	}
	body, err := json.Marshal(struct {
		Schema string `json:"schema"`
		Identity
		Events []json.RawMessage `json:"events"`
	}{UsageSchema, first.Identity, events})
	if err != nil {
		return nil, err
	}
	var ack struct {
		OK        bool     `json:"ok"`
		Schema    string   `json:"schema"`
		Accepted  []string `json:"accepted_ids"`
		Duplicate []string `json:"duplicate_ids"`
	}
	if err = s.request(ctx, "POST", s.UsageURL, body, &ack); err != nil {
		return nil, err
	}
	if !ack.OK || ack.Schema != UsageSchema {
		return nil, fmt.Errorf("usage v2 acknowledgement required")
	}
	ids := append(ack.Accepted, ack.Duplicate...)
	seen := map[string]bool{}
	for _, id := range ids {
		if !sent[id] || seen[id] {
			return nil, fmt.Errorf("collector acknowledged an invalid event ID")
		}
		seen[id] = true
	}
	return ids, nil
}
