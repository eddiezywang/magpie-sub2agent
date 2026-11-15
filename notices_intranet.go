//go:build intranet

package main

import _ "embed"

//go:embed LICENSE
var projectLicense string

//go:embed plugins/modelmap/LICENSE
var modelMapLicense string

//go:embed build/intranet/BUN-LICENSE.md
var bunLicense string

//go:embed build/pixel-icons/vendor/LICENSE
var pixelIconLicense string

func extraNotices() string {
	return "\n\nProject license\n" + projectLicense + "\n\nModel map license\n" + modelMapLicense + "\n\nBun runtime notices\n" + bunLicense + "\n\nOmaPixIcon license\n" + pixelIconLicense
}
