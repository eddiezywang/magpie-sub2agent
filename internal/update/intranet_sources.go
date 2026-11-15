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

var internalReleaseSources = []string{distribution.AppMirror, distribution.Base + "/sub2agent/releases", distribution.AppPublicMirror}

// latestInternal checks the domain first, then the two independent hosts. It
// chooses the newest valid signed feed so a stale mirror cannot hide a release;
// equally recent feeds retain source order.
func latestInternal(ctx context.Context, lang string) (*Release, error) {
	type result struct {
		index   int
		release *Release
		err     error
	}
	ch := make(chan result, len(internalReleaseSources))
	for i, base := range internalReleaseSources {
		go func(i int, base string) {
			attempt, cancel := context.WithTimeout(ctx, 8*time.Second)
			defer cancel()
			r, err := latestFrom(attempt, base+"/latest.json", lang)
			ch <- result{i, r, err}
		}(i, base)
	}
	var failures []string
	var latest *Release
	bestIndex := len(internalReleaseSources)
	for range internalReleaseSources {
		select {
		case got := <-ch:
			if got.err != nil {
				failures = append(failures, got.err.Error())
				continue
			}
			if latest == nil || Newer(got.release.Version, latest.Version) || (got.release.Version == latest.Version && got.index < bestIndex) {
				latest, bestIndex = got.release, got.index
			}
		case <-ctx.Done():
			if latest != nil {
				return latest, nil
			}
			return nil, ctx.Err()
		}
	}
	if latest != nil {
		return latest, nil
	}
	return nil, fmt.Errorf("update sources failed: %s", strings.Join(failures, "; "))
}

// internalAssetSources maps a versioned release path to the configured sources
// in priority order. The asset checksum remains the one from the signed feed.
func internalAssetSources(raw string) []string {
	u, err := url.Parse(raw)
	if err != nil || u.RawQuery != "" || u.Fragment != "" || u.User != nil || path.Clean(u.Path) != u.Path {
		return nil
	}
	for _, base := range internalReleaseSources {
		prefix := base + "/"
		if !strings.HasPrefix(raw, prefix) {
			continue
		}
		rest := strings.TrimPrefix(raw, prefix)
		if rest == "" || strings.Contains(rest, "%") || !strings.Contains(rest, "/") {
			return nil
		}
		var sources []string
		for _, target := range internalReleaseSources {
			sources = append(sources, target+"/"+rest)
		}
		return sources
	}
	return nil
}
