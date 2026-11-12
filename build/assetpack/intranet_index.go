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
			out = append(out, line)
		}
	}
	return []byte(strings.Replace(strings.Join(out, "\n"), "</head>", `<style>#barkRow,#barkDailyRow,#updateProxyRow,#updateSourceRow,#update,#updateHide,.pm-mirror,#maskDemo{display:none!important}</style></head>`, 1))
}
