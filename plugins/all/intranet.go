//go:build intranet

package all

import (
	_ "github.com/yetone/magpie/plugins/accounting"
	_ "github.com/yetone/magpie/plugins/budget"
	_ "github.com/yetone/magpie/plugins/gateway"
	_ "github.com/yetone/magpie/plugins/groups"
	_ "github.com/yetone/magpie/plugins/rotation"
	_ "github.com/yetone/magpie/plugins/routing"
	_ "github.com/yetone/magpie/plugins/sessions"
	_ "github.com/yetone/magpie/plugins/usage"
)
