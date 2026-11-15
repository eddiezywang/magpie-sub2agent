package distribution

import (
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strings"
)

// AssetURL permits the internal artifact server and local test servers. This
// policy is used for application resources, never for provider inference.
func AssetURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("invalid internal resource address")
	}
	switch u.Hostname() {
	case "172.21.0.177", "127.0.0.1", "localhost", "::1":
		return nil
	case "uat.rcrai.weoa.com":
		if u.Port() == "" && strings.HasPrefix(u.Path, "/wemail/sub2agent/releases/") && path.Clean(u.Path) == u.Path {
			return nil
		}
	}
	return fmt.Errorf("public resource downloads are disabled: %s", u.Hostname())
}

// AssetClient checks redirects before they connect, retaining the caller's
// transport, timeout and existing redirect policy.
func AssetClient(original *http.Client) *http.Client {
	c := *original
	c.CheckRedirect = func(r *http.Request, via []*http.Request) error {
		if err := AssetURL(r.URL.String()); err != nil {
			return err
		}
		if original.CheckRedirect != nil {
			return original.CheckRedirect(r, via)
		}
		if len(via) >= 10 {
			return fmt.Errorf("stopped after 10 redirects")
		}
		return nil
	}
	return &c
}
