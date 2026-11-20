package catalog

import (
	"strings"

	"github.com/yetone/magpie/internal/distribution"
)

// LongestModelPrefix checks a bare model ID and its separator-delimited
// prefixes, longest first. Model identities and deployment IDs stay separate.
func LongestModelPrefix(id string, known func(string) bool) string {
	for id = bareID(strings.TrimSpace(id)); id != ""; {
		if known(id) {
			return id
		}
		i := strings.LastIndexAny(id, "-_@:")
		if i <= 0 {
			break
		}
		id = id[:i]
	}
	return ""
}

// DeploymentModel strips only managed deployment suffixes, never arbitrary
// words after a model prefix. Request IDs are not rewritten by the catalog.
func DeploymentModel(id string) string {
	if !distribution.Internal {
		return id
	}
	k := strings.ToLower(id)
	bare := k
	if i := strings.LastIndexByte(k, '/'); i >= 0 {
		bare = k[i+1:]
	}
	if !strings.HasPrefix(bare, "glm-") && !strings.HasPrefix(bare, "deepseek-") && !strings.HasPrefix(bare, "minimax-") && !strings.HasPrefix(bare, "hy") && !strings.HasPrefix(bare, "kimi-") && !strings.HasPrefix(bare, "doubao-") {
		return id
	}
	if !strings.ContainsAny(bare, "0123456789") {
		return id
	}
	for _, suffix := range []string{"-openai-zp", "-zp-openai", "-openai-tc", "-tc-openai", "-openai-hs", "-hs-openai", "-zp", "-tc", "-hs", "-maas"} {
		if strings.HasSuffix(k, suffix) {
			return id[:len(id)-len(suffix)]
		}
	}
	if i := strings.LastIndex(k, "-maas-"); i > 0 && i+6 < len(k) {
		suffix := k[i+6:]
		if strings.Trim(suffix, "abcdefghijklmnopqrstuvwxyz0123456789-_.") == "" {
			return id[:i]
		}
	}
	return id
}
