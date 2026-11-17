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
			line = strings.ReplaceAll(line, "<title>magpie</title>", "<title>Sub2Agent</title>")
			line = strings.ReplaceAll(line, "<span>magpie</span>", "<span>Sub2Agent</span>")
			line = strings.ReplaceAll(line, `name="apple-mobile-web-app-title" content="magpie"`, `name="apple-mobile-web-app-title" content="Sub2Agent"`)
			out = append(out, line)
		}
	}
	index := strings.Replace(strings.Join(out, "\n"), "</head>", `<link rel="stylesheet" href="intranet-retro.css"><link rel="stylesheet" href="workspace.css"><style>#view-settings>:not(#internalSettings),#barkRow,#barkDailyRow,#updateProxyRow,#updateSourceRow,#update,#updateHide,.pm-mirror,#maskDemo,#birdRow,#setTab-sync{display:none!important}.logo img{object-fit:contain}.ic>img{image-rendering:pixelated;width:100%!important;height:100%!important}.logo img{image-rendering:pixelated}</style></head>`, 1)
	index = strings.Replace(index, `<script src="app.js"></script>`, `<script src="workspace-i18n.js"></script><script src="plugins/workspace/client.js"></script><script src="workspace-throughput.js"></script><script src="tig-plan-usage.js"></script><script src="app.js"></script>`, 1)
	return []byte(strings.Replace(index, `<script src="app.js"></script>`, `<script src="app.js"></script><script src="intranet-titlebar.js"></script><script src="legacy-suppliers.js"></script>`, 1))
}
