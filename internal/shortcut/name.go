package shortcut

import "github.com/yetone/magpie/internal/distribution"

func shortcutName() string {
	if distribution.Internal {
		return "Sub2Agent"
	}
	return "Magpie"
}
