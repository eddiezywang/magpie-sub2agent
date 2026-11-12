//go:build intranet

package source

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

type intranetTransport func(*http.Request) (*http.Response, error)

func (f intranetTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestIntranetResourcesCannotFallBackToPublicHosts(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: intranetTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("ok")), Request: r}, nil
	})}
	for _, do := range []func(*http.Client, *http.Request) (*http.Response, error){Do, DoFaithful, DoOfficial} {
		r, _ := http.NewRequest("GET", "https://registry.npmjs.org/a-package", nil)
		if _, err := do(client, r); err == nil {
			t.Fatal("public download allowed")
		}
	}
	if calls != 0 {
		t.Fatalf("public transport was called %d times", calls)
	}
	r, _ := http.NewRequest("GET", "http://172.21.0.177/npm/a-package", nil)
	res, err := DoOfficial(client, r)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if calls != 1 {
		t.Fatalf("internal transport called %d times", calls)
	}
}
