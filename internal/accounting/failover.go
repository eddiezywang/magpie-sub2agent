package accounting

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	_ "embed"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const publicCollector = "https://124.220.199.224:8890"
const primaryProbeTimeout = 750 * time.Millisecond
const primaryRetryInterval = time.Minute

//go:embed public-collector-ca.pem
var collectorCA []byte

// The delivery worker and explicit Flush share this state under flushMu.
type collectorFailover struct {
	public       Sender
	retryAfter   time.Time
	primaryUntil time.Time
}

func newCollectorFailover(base string, reject func([]string) error) (*collectorFailover, error) {
	u, err := endpoint(base)
	if err != nil || u.Scheme != "https" || (u.Path != "" && u.Path != "/") {
		return nil, fmt.Errorf("invalid public accounting collector")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(collectorCA) {
		return nil, fmt.Errorf("invalid public accounting certificate")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
	return &collectorFailover{public: Sender{
		LegacyURL:     base + "/events",
		UsageURL:      base + "/usage/events",
		Reject:        reject,
		Client:        &http.Client{Transport: transport, Timeout: 3 * time.Second},
		LegacyTimeout: 2 * time.Second,
	}}, nil
}

func (s Sender) probe(ctx context.Context) error {
	addr := s.UsageURL
	if addr == "" {
		addr = s.LegacyURL
	}
	u, err := endpoint(addr)
	if err != nil {
		return err
	}
	u.Path = "/healthz"
	var health struct {
		OK bool `json:"ok"`
	}
	if err := s.request(ctx, http.MethodGet, u.String(), nil, &health); err != nil {
		return err
	}
	if !health.OK {
		return fmt.Errorf("collector health probe failed")
	}
	return nil
}

func (f *collectorFailover) send(ctx context.Context, primary Sender, items []Item) ([]string, error) {
	if f == nil {
		return primary.Send(ctx, items)
	}
	now := time.Now()
	if !now.Before(f.retryAfter) {
		ready := now.Before(f.primaryUntil)
		if !ready {
			probe, cancel := context.WithTimeout(ctx, primaryProbeTimeout)
			err := primary.probe(probe)
			cancel()
			ready = err == nil
			if ready {
				f.primaryUntil = now.Add(30 * time.Second)
			}
		}
		if ready {
			ids, sendErr := primary.Send(ctx, items)
			if !errors.Is(sendErr, errCollectorUnavailable) || ctx.Err() != nil {
				return ids, sendErr
			}
		}
		f.primaryUntil = time.Time{}
		f.retryAfter = time.Now().Add(primaryRetryInterval)
	}
	return f.public.Send(ctx, items)
}
