package main

import (
	"github.com/yetone/magpie/internal/distribution"
	"strings"
)

func internalIndex(b []byte) []byte {
	lines := strings.Split(string(b), "\n")
	out := lines[:0]
	for _, line := range lines {
		omit := false
		if strings.Contains(line, `data-view="masking"`) {
			omit = true
		}
		// Keep Privacy's sharing, sign-in and session consent controls.
		if strings.Contains(line, `id="findList"`) || strings.Contains(line, `id="redactList"`) || strings.Contains(line, `id="maskActList"`) || strings.Contains(line, `id="maskTryList"`) || strings.Contains(line, `data-t>How it's found<`) || strings.Contains(line, `data-t>What to mask<`) || strings.Contains(line, `data-t>When a value is found<`) || strings.Contains(line, `data-t>Try it<`) {
			omit = true
		}
		for _, id := range distribution.Removed {
			if (strings.Contains(line, "<script ") || strings.Contains(line, "<link ")) && strings.Contains(line, "plugins/"+id+"/") {
				omit = true
			}
		}
		if !omit {
			if strings.Contains(line, `<span class="logo"`) {
				line = `<span class="logo" aria-hidden="true"><img src="icons/sub2agent.svg" width="22" height="22" alt=""></span>`
			}
			line = strings.ReplaceAll(line, "<title>magpie</title>", "<title>sub2agent</title>")
			line = strings.ReplaceAll(line, "<span>magpie</span>", "<span>sub2agent</span>")
			line = strings.ReplaceAll(line, `name="apple-mobile-web-app-title" content="magpie"`, `name="apple-mobile-web-app-title" content="sub2agent"`)
			out = append(out, line)
		}
	}
	return []byte(strings.Replace(strings.Join(out, "\n"), "</head>", `<style>#view-settings>:not(#internalSettings),#barkRow,#barkDailyRow,#updateProxyRow,#updateSourceRow,#update,#updateHide,.pm-mirror,#maskDemo,#birdRow,#setTab-sync{display:none!important}.logo img{object-fit:contain}html[data-theme=dark] .logo img{filter:invert(1)}</style></head>`, 1))
}
