//go:build intranet

package plugin

import "github.com/yetone/magpie/internal/distribution"

func init() {
	distBase = distribution.Dist
	catalogURLs = []string{distribution.Base + "/magpie/plugins/tagged.json"}
	readmeBases = []string{distribution.Base + "/magpie/plugins/readmes/%s.md"}
}
