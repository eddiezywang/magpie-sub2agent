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
		for _, id := range distribution.Removed {
			if (strings.Contains(line, "<script ") || strings.Contains(line, "<link ")) && strings.Contains(line, "plugins/"+id+"/") {
				omit = true
			}
		}
		if !omit {
			if strings.Contains(line, `<span class="logo"`) {
				line = `<span class="logo" aria-hidden="true"><img src="icons/magpie.svg" width="22" height="22" alt=""></span>`
			}
			line = strings.ReplaceAll(line, "<title>magpie</title>", "<title>Sub2Agent</title>")
			line = strings.ReplaceAll(line, "<span>magpie</span>", "<span>Sub2Agent</span>")
			line = strings.ReplaceAll(line, `name="apple-mobile-web-app-title" content="magpie"`, `name="apple-mobile-web-app-title" content="Sub2Agent"`)
			out = append(out, line)
		}
	}
	return []byte(strings.Replace(strings.Join(out, "\n"), "</head>", `<style>#barkRow,#barkDailyRow,#updateProxyRow,#updateSourceRow,#update,#updateHide,.pm-mirror,#maskDemo,#birdRow,#setTab-sync{display:none!important}.logo img{object-fit:contain}html[data-theme=dark] .logo img{filter:invert(1)}</style></head>`, 1))
}
