package update

import (
	"context"
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/distribution"
)

var internalReleaseSources = []string{distribution.Base + "/sub2agent/releases", distribution.AppMirror}

// latestInternal prefers the primary publication and only consults the
// independent copy if that source cannot deliver a valid signed feed.
func latestInternal(ctx context.Context, lang string) (*Release, error) {
	var failures []string
	for _, base := range internalReleaseSources {
		attempt, cancel := context.WithTimeout(ctx, 8*time.Second)
		r, err := latestFrom(attempt, base+"/latest.json", lang)
		cancel()
		if err == nil {
			return r, nil
		}
		failures = append(failures, err.Error())
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, fmt.Errorf("update sources failed: %s", strings.Join(failures, "; "))
}

// internalAlternateAsset maps only a versioned release path between the two
// administrator-controlled sources; the signed checksum remains unchanged.
func internalAlternateAsset(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.RawQuery != "" || u.Fragment != "" || u.User != nil || path.Clean(u.Path) != u.Path {
		return ""
	}
	for i, base := range internalReleaseSources {
		prefix := base + "/"
		if !strings.HasPrefix(raw, prefix) {
			continue
		}
		rest := strings.TrimPrefix(raw, prefix)
		if rest == "" || strings.Contains(rest, "%") || !strings.Contains(rest, "/") {
			return ""
		}
		return internalReleaseSources[1-i] + "/" + rest
	}
	return ""
}
