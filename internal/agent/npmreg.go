package agent

// The intranet distribution installs the agents' CLIs from the office npm
// registry (wnpm) and reads their newest versions from it, npm's own the
// fallback for when it doesn't answer (a machine taken off the office
// network). The public builds never come here: their npm lookups keep the
// mirrors source picks. The office registry is asked directly, over no
// proxy and not through source: source's internal route bars every host
// but the release mirrors, and a LAN registry wants no proxy either.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/distribution"
)

// npmIntranet is the office registry; a var so tests can serve one.
var npmIntranet = distribution.NPMRegistry

// npmIntranetOn turns the office registry on; a var so the public-build
// tests can exercise it.
var npmIntranetOn = distribution.Internal

// npmDirect asks the office registry (and npm's own when it stands in) on
// one direct connection, by no proxy.
var npmDirect = &http.Client{Timeout: 8 * time.Second, Transport: &http.Transport{Proxy: nil}}

var npmIntranetSeen memo

// npmRegistryFor is the registry npm installs from and npm's newest
// versions are read from: the office registry while it answers, asked at
// most every ten minutes and given up on for two, "" for npm's own.
func npmRegistryFor() string {
	if !npmIntranetOn {
		return ""
	}
	return npmIntranetSeen.get("live", "", 10*time.Minute, 2*time.Minute, func() (string, error) {
		req, err := http.NewRequest("GET", npmIntranet+"/", nil)
		if err != nil {
			return "", err
		}
		req.Header.Set("User-Agent", "magpie")
		resp, err := npmDirect.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		if resp.StatusCode >= 500 {
			return "", fmt.Errorf("the office npm registry answered %s", resp.Status)
		}
		return npmIntranet, nil
	})
}

// npmPackumentLatest is pkg's newest version, from the abbreviated
// packument (dist-tags.latest), the one read every registry
// implementation serves: the office registry's software isn't known, so
// npm's own /latest answer isn't assumed of it.
func npmPackumentLatest(reg, pkg string) (string, error) {
	req, err := http.NewRequest("GET", strings.TrimRight(reg, "/")+"/"+pkg, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "magpie")
	req.Header.Set("Accept", "application/vnd.npm.install-v1+json")
	resp, err := npmDirect.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("npm answered %s", resp.Status)
	}
	var r struct {
		DistTags struct {
			Latest string `json:"latest"`
		} `json:"dist-tags"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&r); err != nil {
		return "", err
	}
	if r.DistTags.Latest == "" {
		return "", fmt.Errorf("%s says no latest for %s", reg, pkg)
	}
	return r.DistTags.Latest, nil
}

// npmLatestAt is pkg's newest version from reg's /latest answer, npm's
// own form, asked directly over no proxy: the office registry's fallback.
func npmLatestAt(reg, pkg string) (string, error) {
	req, err := http.NewRequest("GET", strings.TrimRight(reg, "/")+"/"+pkg+"/latest", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "magpie")
	req.Header.Set("Accept", "application/json")
	resp, err := npmDirect.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("npm answered %s", resp.Status)
	}
	var r struct{ Version string }
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&r); err != nil {
		return "", err
	}
	if r.Version == "" {
		return "", errors.New("no version")
	}
	return r.Version, nil
}

// npmGlobalInstall is npm's global install command for a CLI's package,
// from the office registry where it answers: what an update runs, whose
// shown form the row shows.
func npmGlobalInstall(npm, prefix string) []string {
	cmd := []string{npm, "install", "-g", "--prefix", prefix}
	if r := npmRegistryFor(); r != "" {
		cmd = append(cmd, "--registry="+r)
	}
	return cmd
}
